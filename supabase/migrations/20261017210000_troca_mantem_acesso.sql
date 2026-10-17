-- Troca de mesa feita pela equipe: o celular do cliente vai junto, sem pedir liberação de novo.
alter table public.mesa_acessos add column movido_de uuid references public.mesas on delete set null;

create or replace function public.mesa_trocar(p_origem uuid, p_destino uuid) returns int
language plpgsql volatile security definer set search_path = '' as $$
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

  update public.chamados set mesa_id = v_destino.id, mesa_nome = v_destino.nome
  where mesa_id = p_origem and atendido_em is null;

  -- Celulares liberados acompanham o cliente (o tablet fixo fica na mesa dele)
  update public.mesa_acessos set mesa_id = v_destino.id, mesa_nome = v_destino.nome, movido_de = p_origem
  where mesa_id = p_origem and status = 'liberado' and not fixo;
  update public.mesa_acessos set status = 'encerrado', respondido_em = now()
  where mesa_id = p_origem and status = 'pendente';
  return v_qtd;
end $$;

-- Situação do aparelho. Novidades:
--   'em_uso'          → mesa já aberta por outro aparelho (o pedido de acesso ainda passa pelo garçom)
--   'movido:<token>'  → a conta deste aparelho foi levada para outra mesa; o cardápio segue para ela
create or replace function public.mesa_acesso_status(p_token text, p_dispositivo text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_mesa public.mesas := privado.mesa_do_token(p_token);
  v_status text;
  v_destino text;
begin
  if privado.eh_equipe(v_mesa.restaurante_id) then return 'equipe'; end if;
  select status into v_status from public.mesa_acessos
  where mesa_id = v_mesa.id and dispositivo = p_dispositivo
  order by (status = 'liberado') desc, criado_em desc limit 1;
  if v_status in ('liberado', 'pendente', 'recusado') then return v_status; end if;

  select m.token into v_destino
  from public.mesa_acessos a join public.mesas m on m.id = a.mesa_id
  where a.dispositivo = p_dispositivo and a.status = 'liberado' and a.movido_de = v_mesa.id and m.ativo
  order by a.criado_em desc limit 1;
  if v_destino is not null then return 'movido:' || v_destino; end if;

  if exists (select 1 from public.mesa_acessos where mesa_id = v_mesa.id and status = 'liberado')
     or exists (select 1 from public.pedidos where mesa_id = v_mesa.id and pago_em is null and status <> 'cancelado') then
    return 'em_uso';
  end if;
  return 'nenhum';
end $$;
