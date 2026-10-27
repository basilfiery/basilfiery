-- Fechar a conta da mesa com várias formas e valores (cada pessoa paga de um jeito),
-- desconto e acréscimo. Cada parte vira um pagamento no caixa; a primeira é a "principal"
-- (os pedidos apontam para ela) e as outras guardam conta_id = principal.

alter table public.pedidos add column if not exists acrescimo numeric(10,2) not null default 0 check (acrescimo >= 0);
alter table public.pagamentos add column if not exists conta_id uuid;
create index if not exists pagamentos_conta_id_idx on public.pagamentos (conta_id);

create or replace function public.mesa_receber_conta(p_mesa uuid, p_pagamentos jsonb, p_desconto numeric default 0, p_acrescimo numeric default 0)
returns numeric
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_mesa public.mesas;
  v_caixa uuid;
  v_sub numeric(10,2);
  v_desc numeric(10,2) := round(greatest(coalesce(p_desconto, 0), 0), 2);
  v_acr numeric(10,2) := round(greatest(coalesce(p_acrescimo, 0), 0), 2);
  v_devido numeric(10,2);
  v_soma numeric(10,2) := 0;
  v_pag uuid := gen_random_uuid();
  v_item jsonb;
  v_forma text;
  v_valor numeric(10,2);
  v_n int := 0;
  v_resto numeric(10,2);
  v_ped record;
  v_parte numeric(10,2);
begin
  select * into v_mesa from public.mesas where id = p_mesa for update;
  if not found or not public.tem_papel(v_mesa.restaurante_id, '{dono,gerente,caixa}') then
    raise exception 'Sem permissão para fechar contas';
  end if;
  select id into v_caixa from public.caixas where restaurante_id = v_mesa.restaurante_id and fechado_em is null;
  if v_caixa is null then raise exception 'Abra o caixa antes de receber pagamentos'; end if;

  select coalesce(sum(total), 0) into v_sub
  from public.pedidos where mesa_id = p_mesa and pago_em is null and status <> 'cancelado';
  if v_desc > v_sub then raise exception 'O desconto é maior que a conta'; end if;
  if v_acr > greatest(v_sub, 100) then raise exception 'Acréscimo muito alto'; end if;
  v_devido := v_sub - v_desc + v_acr;

  if jsonb_typeof(coalesce(p_pagamentos, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_pagamentos, '[]'::jsonb)) > 30 then
    raise exception 'Pagamentos inválidos';
  end if;
  for v_item in select * from jsonb_array_elements(coalesce(p_pagamentos, '[]'::jsonb)) loop
    v_forma := v_item ->> 'forma';
    v_valor := round(coalesce(nullif(v_item ->> 'valor', '')::numeric, 0), 2);
    if v_forma not in ('dinheiro', 'pix', 'credito', 'debito', 'outro') then raise exception 'Forma de pagamento inválida'; end if;
    if v_valor <= 0 then raise exception 'Valor de pagamento inválido'; end if;
    v_soma := v_soma + v_valor;
  end loop;
  if abs(v_soma - v_devido) >= 0.01 then
    raise exception 'Os pagamentos somam R$ % e a conta é R$ %', replace(to_char(v_soma, 'FM999990.00'), '.', ','), replace(to_char(v_devido, 'FM999990.00'), '.', ',');
  end if;

  -- Desconto: abate dos pedidos (maiores primeiro); acréscimo: entra no último pedido
  v_resto := v_desc;
  for v_ped in select id, total from public.pedidos
    where mesa_id = p_mesa and pago_em is null and status <> 'cancelado' order by total desc, criado_em loop
    exit when v_resto <= 0;
    v_parte := least(v_resto, v_ped.total);
    update public.pedidos set desconto = desconto + v_parte, total = total - v_parte where id = v_ped.id;
    v_resto := v_resto - v_parte;
  end loop;
  if v_acr > 0 then
    update public.pedidos set acrescimo = acrescimo + v_acr, total = total + v_acr
    where id = (select id from public.pedidos where mesa_id = p_mesa and pago_em is null and status <> 'cancelado' order by criado_em desc limit 1);
  end if;

  -- As partes entram antes da principal: o aviso de "Nova venda" sai uma vez só, com o total
  if v_devido > 0 then
    for v_item in select * from jsonb_array_elements(p_pagamentos) loop
      v_n := v_n + 1;
      if v_n = 1 then continue; end if;
      insert into public.pagamentos (restaurante_id, caixa_id, mesa_id, mesa_nome, forma, valor, conta_id)
      values (v_mesa.restaurante_id, v_caixa, v_mesa.id, v_mesa.nome, v_item ->> 'forma', round((v_item ->> 'valor')::numeric, 2), v_pag);
    end loop;
    insert into public.pagamentos (id, restaurante_id, caixa_id, mesa_id, mesa_nome, forma, valor)
    values (v_pag, v_mesa.restaurante_id, v_caixa, v_mesa.id, v_mesa.nome, p_pagamentos -> 0 ->> 'forma', round((p_pagamentos -> 0 ->> 'valor')::numeric, 2));
  else
    v_pag := null;
  end if;

  update public.pedidos set pago_em = now(), pagamento_id = case when status = 'cancelado' then null else v_pag end
  where mesa_id = p_mesa and pago_em is null;
  update public.chamados set atendido_em = now() where mesa_id = p_mesa and atendido_em is null;
  update public.mesa_acessos set status = 'encerrado', respondido_em = now()
  where mesa_id = p_mesa and status in ('liberado', 'pendente') and not fixo;
  update public.mesas set pessoas = null where id = p_mesa;
  return v_devido;
end $$;
revoke execute on function public.mesa_receber_conta(uuid, jsonb, numeric, numeric) from public;
grant execute on function public.mesa_receber_conta(uuid, jsonb, numeric, numeric) to authenticated;

-- Aviso de venda: as partes da conta dividida não avisam; a principal avisa com o total
create or replace function privado.notificar_push()
returns trigger
language plpgsql security definer set search_path = '' as $function$
declare
  v_url text;
  v_segredo text;
  v_payload jsonb;
  v_valor text;
begin
  select valor into v_url from privado.config where chave = 'push_url';
  select valor into v_segredo from privado.config where chave = 'push_segredo';
  if v_url is null then return new; end if;

  if tg_table_name = 'pedidos' then
    v_valor := 'R$ ' || replace(to_char(new.total, 'FM999990.00'), '.', ',');
    if tg_op = 'INSERT' then
      -- Balcão já pago: o aviso é a venda (pelo pagamento)
      if new.tipo = 'balcao' and new.status = 'entregue' then return new; end if;
      v_payload := jsonb_build_object(
        'titulo', 'Novo pedido #' || new.numero || ' · ' || new.mesa_nome,
        'corpo', 'Total ' || v_valor,
        'tag', 'pedido-' || new.id,
        'evento', 'pedido', 'mesa', new.mesa_nome, 'valor', v_valor);
    elsif new.status = 'pronto' and old.status is distinct from 'pronto' then
      v_payload := jsonb_build_object(
        'titulo', 'Pedido #' || new.numero || ' pronto · ' || new.mesa_nome,
        'corpo', case when new.tipo = 'mesa' then 'Pode levar para a mesa.' else 'Pode entregar.' end,
        'tag', 'pedido-' || new.id, 'evento', 'pronto');
    elsif new.status = 'entregue' and old.status is distinct from 'entregue' and new.tipo in ('delivery', 'retirada') then
      v_payload := jsonb_build_object(
        'titulo', 'Nova venda! ' || v_valor,
        'corpo', new.mesa_nome || ' #' || new.numero || ' entregue',
        'tag', 'venda-' || new.id, 'evento', 'venda', 'mesa', new.mesa_nome, 'valor', v_valor);
    else
      return new;
    end if;
  elsif tg_table_name = 'pagamentos' then
    if new.conta_id is not null then return new; end if;
    v_valor := 'R$ ' || replace(to_char(new.valor + coalesce((select sum(valor) from public.pagamentos where conta_id = new.id), 0), 'FM999990.00'), '.', ',');
    v_payload := jsonb_build_object(
      'titulo', 'Nova venda! ' || v_valor,
      'corpo', new.mesa_nome || ' · conta paga',
      'tag', 'venda-' || new.id, 'evento', 'venda', 'mesa', new.mesa_nome, 'valor', v_valor);
  elsif tg_table_name = 'chamados' then
    v_payload := jsonb_build_object(
      'titulo', case
        when new.tipo = 'conta' then new.mesa_nome || ' pediu a conta'
        when new.motivo is not null then new.mesa_nome || ': ' || new.motivo
        else new.mesa_nome || ' chamou o garçom' end,
      'corpo', coalesce(new.detalhe, 'Toque para ver e marcar como atendido.'),
      'tag', 'chamado-' || new.id, 'evento', 'chamado');
  elsif tg_table_name = 'mesa_acessos' then
    v_payload := jsonb_build_object(
      'titulo', new.mesa_nome || ' quer fazer pedidos',
      'corpo', 'Toque para liberar a mesa' || coalesce(' (' || new.aparelho || ')', '') || '.',
      'tag', 'acesso-' || new.id, 'evento', 'acesso');
  else
    return new;
  end if;

  v_payload := v_payload || jsonb_build_object('restaurante_id', new.restaurante_id, 'url', '/garcom');
  perform net.http_post(
    url := v_url,
    body := v_payload,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-segredo', v_segredo)
  );
  return new;
end $function$;
