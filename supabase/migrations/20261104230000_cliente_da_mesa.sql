-- Cliente da mesa: nome e WhatsApp salvos na mesa enquanto ela está aberta (aparece para o garçom).
-- Zera ao fechar a conta e acompanha a troca de mesa.
alter table public.mesas
  add column cliente_nome text check (char_length(cliente_nome) <= 80),
  add column cliente_telefone text check (cliente_telefone ~ '^[0-9]{10,13}$');

create or replace function public.mesa_definir_cliente(p_mesa uuid, p_nome text, p_telefone text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_rest uuid;
  v_tel text := nullif(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g'), '');
begin
  select restaurante_id into v_rest from public.mesas where id = p_mesa;
  if v_rest is null or not public.eh_membro(v_rest) then raise exception 'Mesa não encontrada'; end if;
  if v_tel is not null and char_length(v_tel) not between 10 and 13 then raise exception 'WhatsApp precisa ter DDD'; end if;
  update public.mesas set cliente_nome = nullif(left(trim(coalesce(p_nome, '')), 80), ''), cliente_telefone = v_tel where id = p_mesa;
end $$;
revoke execute on function public.mesa_definir_cliente(uuid, text, text) from public, anon;
grant execute on function public.mesa_definir_cliente(uuid, text, text) to authenticated;

CREATE OR REPLACE FUNCTION public.mesa_receber_conta(p_mesa uuid, p_pagamentos jsonb, p_desconto numeric DEFAULT 0, p_acrescimo numeric DEFAULT 0)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  update public.mesas set pessoas = null, cliente_nome = null, cliente_telefone = null where id = p_mesa;
  return v_devido;
end $function$;

CREATE OR REPLACE FUNCTION public.mesa_fechar_conta(p_mesa uuid, p_forma text DEFAULT 'outro'::text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_mesa public.mesas;
  v_caixa uuid;
  v_total numeric;
  v_pag uuid;
begin
  select * into v_mesa from public.mesas where id = p_mesa;
  if not found or not public.tem_papel(v_mesa.restaurante_id, '{dono,gerente,caixa}') then
    raise exception 'Sem permissão para fechar contas';
  end if;
  if p_forma not in ('dinheiro', 'pix', 'credito', 'debito', 'outro') then raise exception 'Forma de pagamento inválida'; end if;

  select id into v_caixa from public.caixas where restaurante_id = v_mesa.restaurante_id and fechado_em is null;
  if v_caixa is null then raise exception 'Abra o caixa antes de receber pagamentos'; end if;

  select coalesce(sum(total), 0) into v_total
  from public.pedidos where mesa_id = p_mesa and pago_em is null and status <> 'cancelado';

  if v_total > 0 then
    insert into public.pagamentos (restaurante_id, caixa_id, mesa_id, mesa_nome, forma, valor)
    values (v_mesa.restaurante_id, v_caixa, v_mesa.id, v_mesa.nome, p_forma, v_total)
    returning id into v_pag;
  end if;

  update public.pedidos set pago_em = now(), pagamento_id = case when status = 'cancelado' then null else v_pag end
  where mesa_id = p_mesa and pago_em is null;
  update public.chamados set atendido_em = now() where mesa_id = p_mesa and atendido_em is null;
  update public.mesa_acessos set status = 'encerrado', respondido_em = now()
  where mesa_id = p_mesa and status in ('liberado', 'pendente') and not fixo;
  -- Mesa livre de novo: zera a quantidade de pessoas
  update public.mesas set pessoas = null, cliente_nome = null, cliente_telefone = null where id = p_mesa;
  return v_total;
end $function$;

CREATE OR REPLACE FUNCTION public.mesa_trocar(p_origem uuid, p_destino uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- Nome/telefone do cliente vão junto (a mesa antiga fica livre)
  update public.mesas set cliente_nome = coalesce(v_destino.cliente_nome, v_origem.cliente_nome),
    cliente_telefone = coalesce(v_destino.cliente_telefone, v_origem.cliente_telefone),
    pessoas = coalesce(v_destino.pessoas, v_origem.pessoas)
  where id = v_destino.id;
  update public.mesas set cliente_nome = null, cliente_telefone = null, pessoas = null where id = p_origem;

  update public.chamados set mesa_id = v_destino.id, mesa_nome = v_destino.nome
  where mesa_id = p_origem and atendido_em is null;

  -- Celulares liberados acompanham o cliente (o tablet fixo fica na mesa dele)
  update public.mesa_acessos set mesa_id = v_destino.id, mesa_nome = v_destino.nome, movido_de = p_origem
  where mesa_id = p_origem and status = 'liberado' and not fixo;
  update public.mesa_acessos set status = 'encerrado', respondido_em = now()
  where mesa_id = p_origem and status = 'pendente';
  return v_qtd;
end $function$;
