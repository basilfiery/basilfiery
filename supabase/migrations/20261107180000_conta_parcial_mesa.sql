-- Pagamentos parciais da mesa (ex.: um cliente já pagou R$ 20 em dinheiro) ficam guardados na mesa
-- até fechar a conta: aparecem no painel (mesa "Pagando"), no app do garçom e na conta do cliente.
alter table public.mesas add column if not exists conta_parcial jsonb;

create or replace function public.mesa_conta_parcial_salvar(p_mesa uuid, p_dados jsonb)
returns void language plpgsql security definer set search_path to '' as $function$
declare
  v_mesa public.mesas;
  v_partes jsonb := '[]'::jsonb;
  v_item jsonb;
  v_valor int;
  v_rec int;
  v_pago int := 0;
  v_desc text := left(btrim(coalesce(p_dados ->> 'desconto', '')), 20);
  v_acr text := left(btrim(coalesce(p_dados ->> 'acrescimo', '')), 20);
begin
  select * into v_mesa from public.mesas where id = p_mesa for update;
  if not found or not public.tem_papel(v_mesa.restaurante_id, '{dono,gerente,caixa}') then
    raise exception 'Sem permissão para receber contas';
  end if;
  if jsonb_typeof(coalesce(p_dados -> 'partes', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_dados -> 'partes', '[]'::jsonb)) > 30 then
    raise exception 'Pagamentos inválidos';
  end if;
  for v_item in select * from jsonb_array_elements(coalesce(p_dados -> 'partes', '[]'::jsonb)) loop
    if (v_item ->> 'forma') not in ('dinheiro', 'pix', 'credito', 'debito', 'outro') then raise exception 'Forma de pagamento inválida'; end if;
    v_valor := round(coalesce(nullif(v_item ->> 'valor', '')::numeric, 0))::int;
    if v_valor <= 0 or v_valor > 10000000 then raise exception 'Valor de pagamento inválido'; end if;
    v_rec := round(nullif(v_item ->> 'recebido', '')::numeric)::int;
    v_pago := v_pago + v_valor;
    v_partes := v_partes || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'id', left(coalesce(v_item ->> 'id', gen_random_uuid()::text), 40),
      'forma', v_item ->> 'forma', 'valor', v_valor, 'recebido', v_rec)));
  end loop;

  update public.mesas set conta_parcial = case
    when jsonb_array_length(v_partes) = 0 and v_desc = '' and v_acr = '' then null
    else jsonb_build_object('partes', v_partes, 'pago', v_pago, 'desconto', v_desc, 'acrescimo', v_acr, 'atualizado_em', now())
  end
  where id = p_mesa;
end $function$;
revoke all on function public.mesa_conta_parcial_salvar(uuid, jsonb) from public, anon;
grant execute on function public.mesa_conta_parcial_salvar(uuid, jsonb) to authenticated;

-- Fechar / liberar a mesa limpa o que estava pago em parte; trocar de mesa leva junto
create or replace function privado.mesa_limpa_parcial() returns trigger language plpgsql set search_path to '' as $$
begin
  if new.pessoas is null and new.cliente_nome is null and new.cliente_telefone is null
     and new.conta_parcial is not null and not exists (
       select 1 from public.pedidos where mesa_id = new.id and pago_em is null and status <> 'cancelado') then
    new.conta_parcial := null;
  end if;
  return new;
end $$;
drop trigger if exists mesa_limpa_parcial on public.mesas;
create trigger mesa_limpa_parcial before update on public.mesas for each row execute function privado.mesa_limpa_parcial();

create or replace function public.mesa_trocar(p_origem uuid, p_destino uuid)
 returns integer language plpgsql security definer set search_path to '' as $function$
declare
  v_origem public.mesas;
  v_destino public.mesas;
  v_qtd int;
begin
  select * into v_origem from public.mesas where id = p_origem;
  select * into v_destino from public.mesas where id = p_destino;
  if v_origem.id is null or v_destino.id is null then raise exception 'Mesa não encontrada'; end if;
  if v_origem.restaurante_id <> v_destino.restaurante_id then raise exception 'As mesas são de restaurantes diferentes'; end if;
  if not public.tem_papel(v_origem.restaurante_id, '{dono,gerente,caixa,garcom}') then
    raise exception 'Sem permissão para trocar mesas';
  end if;
  if p_origem = p_destino then raise exception 'Escolha uma mesa diferente'; end if;

  update public.pedidos set mesa_id = v_destino.id, mesa_nome = v_destino.nome, atualizado_em = now()
  where mesa_id = p_origem and pago_em is null;
  get diagnostics v_qtd = row_count;
  if v_qtd = 0 then raise exception 'A % não tem conta aberta para trocar', v_origem.nome; end if;

  -- Nome/telefone do cliente e o que já foi pago vão junto (a mesa antiga fica livre)
  update public.mesas set cliente_nome = coalesce(v_destino.cliente_nome, v_origem.cliente_nome),
    cliente_telefone = coalesce(v_destino.cliente_telefone, v_origem.cliente_telefone),
    pessoas = coalesce(v_destino.pessoas, v_origem.pessoas),
    conta_parcial = case
      when v_destino.conta_parcial is null then v_origem.conta_parcial
      when v_origem.conta_parcial is null then v_destino.conta_parcial
      else jsonb_build_object(
        'partes', coalesce(v_destino.conta_parcial -> 'partes', '[]'::jsonb) || coalesce(v_origem.conta_parcial -> 'partes', '[]'::jsonb),
        'pago', coalesce((v_destino.conta_parcial ->> 'pago')::int, 0) + coalesce((v_origem.conta_parcial ->> 'pago')::int, 0),
        'desconto', '', 'acrescimo', '', 'atualizado_em', now())
    end
  where id = v_destino.id;
  update public.mesas set cliente_nome = null, cliente_telefone = null, pessoas = null, conta_parcial = null where id = p_origem;

  update public.chamados set mesa_id = v_destino.id, mesa_nome = v_destino.nome
  where mesa_id = p_origem and atendido_em is null;

  -- Celulares liberados acompanham o cliente (o tablet fixo fica na mesa dele)
  update public.mesa_acessos set mesa_id = v_destino.id, mesa_nome = v_destino.nome, movido_de = p_origem
  where mesa_id = p_origem and status = 'liberado' and not fixo;
  update public.mesa_acessos set status = 'encerrado', respondido_em = now()
  where mesa_id = p_origem and status = 'pendente';
  return v_qtd;
end $function$;

-- Conta do cliente (tablet/celular da mesa) mostra o que já foi pago
create or replace function public.mesa_conta(p_token text)
 returns jsonb language plpgsql stable security definer set search_path to '' as $function$
declare
  v_mesa public.mesas;
begin
  select * into v_mesa from public.mesas where token = p_token and ativo;
  if not found then raise exception 'Mesa não encontrada'; end if;
  return jsonb_build_object(
    'pedidos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'numero', p.numero, 'status', p.status, 'total', p.total, 'criado_em', p.criado_em,
        'itens', (select jsonb_agg(jsonb_build_object('nome', i.nome, 'qtd', i.qtd, 'preco', i.preco_unit, 'obs', i.obs, 'complementos', i.complementos))
                  from public.pedido_itens i where i.pedido_id = p.id)
      ) order by p.criado_em)
      from public.pedidos p
      where p.mesa_id = v_mesa.id and p.pago_em is null and p.status <> 'cancelado'
    ), '[]'::jsonb),
    'total', coalesce((
      select sum(p.total) from public.pedidos p
      where p.mesa_id = v_mesa.id and p.pago_em is null and p.status <> 'cancelado'
    ), 0),
    'parcial', case when v_mesa.conta_parcial is null then null else jsonb_build_object(
      'partes', coalesce((select jsonb_agg(jsonb_build_object('forma', x ->> 'forma', 'valor', (x ->> 'valor')::int))
                          from jsonb_array_elements(v_mesa.conta_parcial -> 'partes') x), '[]'::jsonb),
      'desconto', coalesce(v_mesa.conta_parcial ->> 'desconto', ''),
      'acrescimo', coalesce(v_mesa.conta_parcial ->> 'acrescimo', '')) end
  );
end $function$;

-- Painel e app do garçom recebem a mudança na hora
do $$ begin
  alter publication supabase_realtime add table public.mesas;
exception when duplicate_object then null; end $$;
