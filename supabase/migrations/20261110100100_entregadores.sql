-- Entregadores (motoboys) + frete grátis em dias da semana.
-- Frete grátis: o cliente não paga a entrega, mas a corrida do motoboy continua valendo (taxa_entregador).

-- ---------- Configuração da loja ----------
alter table public.restaurantes
  add column if not exists frete_gratis_dias smallint[] not null default '{}',   -- 0 = domingo … 6 = sábado
  add column if not exists frete_gratis_minimo numeric(10,2) not null default 0, -- pedido mínimo (itens) para ganhar o frete grátis
  add column if not exists corrida_fixa numeric(10,2);                          -- null = o motoboy recebe a taxa de entrega normal

-- ---------- Pedido de entrega ----------
alter table public.pedidos
  add column if not exists entregador_id uuid references auth.users(id) on delete set null,
  add column if not exists entregador_nome text,
  add column if not exists saiu_em timestamptz,
  add column if not exists entregue_em timestamptz,
  add column if not exists frete_gratis boolean not null default false,
  add column if not exists taxa_entregador numeric(10,2),
  add column if not exists entregador_pago_em timestamptz;
create index if not exists pedidos_entregador_idx on public.pedidos (restaurante_id, entregador_id, entregue_em) where entregador_id is not null;

-- É entregador nesta loja? (sem o atalho do administrador da plataforma)
create or replace function public.eh_entregador(p_rest uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.membros where restaurante_id = p_rest and user_id = (select auth.uid()) and papel = 'entregador');
$$;
grant execute on function public.eh_entregador(uuid) to authenticated;

-- Entregador só enxerga pedidos de entrega
drop policy if exists "ver pedidos" on public.pedidos;
create policy "ver pedidos" on public.pedidos for select to authenticated
  using (public.eh_membro(restaurante_id) and (tipo = 'delivery' or not public.eh_entregador(restaurante_id)));
drop policy if exists "ver itens" on public.pedido_itens;
create policy "ver itens" on public.pedido_itens for select to authenticated
  using (public.eh_membro(restaurante_id) and (not public.eh_entregador(restaurante_id)
    or exists (select 1 from public.pedidos p where p.id = pedido_id and p.tipo = 'delivery')));

-- Hoje tem frete grátis? (dia da semana no fuso da loja + pedido mínimo)
create or replace function privado.frete_gratis_hoje(p_rest public.restaurantes, p_itens numeric)
returns boolean language sql stable set search_path to '' as $$
  select coalesce(array_length(p_rest.frete_gratis_dias, 1), 0) > 0
     and extract(dow from now() at time zone coalesce(nullif(p_rest.fuso, ''), 'America/Sao_Paulo'))::smallint = any (p_rest.frete_gratis_dias)
     and coalesce(p_itens, 0) >= coalesce(p_rest.frete_gratis_minimo, 0);
$$;

-- Taxa de entrega pelo endereço (fixa, por bairro ou por distância). null = não deu para calcular.
create or replace function privado.taxa_do_endereco(p_rest public.restaurantes, p_end jsonb)
returns numeric language plpgsql stable set search_path to '' as $$
declare v_taxa numeric; v_lat float8; v_lng float8; v_dist numeric;
begin
  if p_rest.entrega_modo = 'bairro' then
    select (b ->> 'taxa')::numeric into v_taxa from jsonb_array_elements(p_rest.entrega_bairros) b
    where lower(trim(b ->> 'nome')) = lower(trim(p_end ->> 'bairro')) limit 1;
    return v_taxa;
  elsif p_rest.entrega_modo = 'raio' then
    v_lat := nullif(p_end ->> 'lat', '')::float8;
    v_lng := nullif(p_end ->> 'lng', '')::float8;
    if v_lat is null or v_lng is null or p_rest.lat is null then return null; end if;
    v_dist := round((6371 * 2 * asin(sqrt(
      power(sin(radians(v_lat - p_rest.lat) / 2), 2) +
      cos(radians(p_rest.lat)) * cos(radians(v_lat)) * power(sin(radians(v_lng - p_rest.lng) / 2), 2))))::numeric, 2);
    select (r ->> 'taxa')::numeric into v_taxa from jsonb_array_elements(p_rest.entrega_raios) r
    where (r ->> 'ate_km')::numeric >= v_dist order by (r ->> 'ate_km')::numeric limit 1;
    return v_taxa;
  end if;
  return p_rest.delivery_taxa;
end $$;

-- ---------- Pedido pelo cardápio digital: frete grátis no dia + corrida do motoboy ----------
create or replace function public.loja_pedido_enviar(p_codigo text, p_tipo text, p_itens jsonb, p_cliente jsonb, p_obs text default null)
 returns jsonb language plpgsql security definer set search_path to '' as $function$
declare
  v_rest public.restaurantes;
  v_todas jsonb;
  v_preparo boolean;
  v_itens_total numeric(10,2);
  v_taxa numeric(10,2) := 0;
  v_corrida numeric(10,2);
  v_gratis boolean := false;
  v_numero int;
  v_pedido uuid;
  v_acompanhar text := replace(gen_random_uuid()::text, '-', '');
  v_cli_nome text := nullif(left(trim(p_cliente ->> 'nome'), 80), '');
  v_cli_tel text := nullif(regexp_replace(coalesce(p_cliente ->> 'telefone', ''), '\D', '', 'g'), '');
  v_forma text := p_cliente ->> 'pagamento';
  v_troco numeric(10,2) := nullif(p_cliente ->> 'troco', '')::numeric;
  v_end jsonb := null;
  v_lat float8;
  v_lng float8;
  v_dist numeric;
begin
  select * into v_rest from public.restaurantes where codigo = lower(trim(p_codigo));
  if not found or not v_rest.ativo then raise exception 'Loja não encontrada'; end if;
  if not privado.loja_aberta(v_rest) then raise exception 'A loja está fechada para pedidos agora'; end if;
  if p_tipo not in ('delivery', 'retirada') then raise exception 'Escolha entrega ou retirada'; end if;
  if p_tipo = 'delivery' and not v_rest.entrega_ativa then raise exception 'Esta loja não faz entrega agora'; end if;
  if p_tipo = 'retirada' and not v_rest.retirada_ativa then raise exception 'Esta loja não faz retirada no balcão'; end if;
  if v_cli_nome is null then raise exception 'Informe seu nome'; end if;
  if v_cli_tel is null or char_length(v_cli_tel) not between 10 and 13 then raise exception 'Informe um telefone com DDD'; end if;
  if v_forma is null or not (v_forma = any (v_rest.formas_pagamento)) then raise exception 'Escolha a forma de pagamento'; end if;
  if jsonb_typeof(p_itens) = 'array' and jsonb_array_length(p_itens) > 50 then raise exception 'Itens demais em um só pedido'; end if;
  if (select count(*) from public.pedidos where restaurante_id = v_rest.id and cliente_telefone = v_cli_tel
      and criado_em > now() - interval '30 minutes' and status in ('novo', 'preparando')) >= 3 then
    raise exception 'Você já tem pedidos em andamento. Aguarde ou fale com a loja.';
  end if;
  if p_tipo = 'delivery' then
    if nullif(trim(p_cliente -> 'endereco' ->> 'rua'), '') is null or nullif(trim(p_cliente -> 'endereco' ->> 'numero'), '') is null
       or nullif(trim(p_cliente -> 'endereco' ->> 'bairro'), '') is null then
      raise exception 'Informe rua, número e bairro para a entrega';
    end if;
    v_end := jsonb_build_object(
      'rua', left(trim(p_cliente -> 'endereco' ->> 'rua'), 120),
      'numero', left(trim(p_cliente -> 'endereco' ->> 'numero'), 20),
      'bairro', left(trim(p_cliente -> 'endereco' ->> 'bairro'), 80),
      'complemento', nullif(left(trim(coalesce(p_cliente -> 'endereco' ->> 'complemento', '')), 80), ''),
      'referencia', nullif(left(trim(coalesce(p_cliente -> 'endereco' ->> 'referencia', '')), 120), '')
    );
    -- Taxa: fixa, por bairro ou por distância (raio a partir da loja)
    if v_rest.entrega_modo = 'bairro' then
      v_taxa := null;
      select (b ->> 'taxa')::numeric into v_taxa from jsonb_array_elements(v_rest.entrega_bairros) b
      where lower(trim(b ->> 'nome')) = lower(trim(p_cliente -> 'endereco' ->> 'bairro')) limit 1;
      if v_taxa is null then raise exception 'A loja não entrega no bairro "%"', trim(p_cliente -> 'endereco' ->> 'bairro'); end if;
    elsif v_rest.entrega_modo = 'raio' then
      v_lat := nullif(p_cliente -> 'endereco' ->> 'lat', '')::float8;
      v_lng := nullif(p_cliente -> 'endereco' ->> 'lng', '')::float8;
      if v_lat is null or v_lng is null or v_rest.lat is null then raise exception 'Confirme a localização do endereço para calcular a entrega'; end if;
      v_dist := round((6371 * 2 * asin(sqrt(
        power(sin(radians(v_lat - v_rest.lat) / 2), 2) +
        cos(radians(v_rest.lat)) * cos(radians(v_lat)) * power(sin(radians(v_lng - v_rest.lng) / 2), 2))))::numeric, 2);
      v_taxa := null;
      select (r ->> 'taxa')::numeric into v_taxa from jsonb_array_elements(v_rest.entrega_raios) r
      where (r ->> 'ate_km')::numeric >= v_dist order by (r ->> 'ate_km')::numeric limit 1;
      if v_taxa is null then raise exception 'Endereço fora da área de entrega (% km da loja)', replace(v_dist::text, '.', ','); end if;
      v_end := v_end || jsonb_build_object('lat', v_lat, 'lng', v_lng, 'distancia_km', v_dist);
    else
      v_taxa := v_rest.delivery_taxa;
    end if;
    -- O motoboy recebe a corrida (valor fixo da loja ou a taxa normal), mesmo com frete grátis
    v_corrida := coalesce(v_rest.corrida_fixa, v_taxa);
  end if;

  -- Loja que desligou a observação: ignora o que vier
  if not v_rest.loja_obs and jsonb_typeof(p_itens) = 'array' then
    select jsonb_agg(e - 'obs') into p_itens from jsonb_array_elements(p_itens) e;
  end if;
  v_todas := privado.precificar(v_rest.id, p_itens);
  select coalesce(sum((l ->> 'preco')::numeric * (l ->> 'qtd')::int), 0), coalesce(bool_or((l ->> 'preparo')::boolean), false)
  into v_itens_total, v_preparo from jsonb_array_elements(v_todas) l;

  if v_itens_total < v_rest.delivery_minimo then
    raise exception 'O pedido mínimo é de R$ %', replace(to_char(v_rest.delivery_minimo, 'FM999990.00'), '.', ',');
  end if;
  -- Frete grátis no dia (ex.: toda terça): o cliente não paga a entrega
  if p_tipo = 'delivery' and privado.frete_gratis_hoje(v_rest, v_itens_total) then
    v_gratis := true;
    v_taxa := 0;
  end if;
  if v_forma = 'dinheiro' and v_troco is not null and v_troco < v_itens_total + v_taxa then v_troco := null; end if;

  update public.restaurantes set ultimo_pedido = ultimo_pedido + 1 where id = v_rest.id returning ultimo_pedido into v_numero;

  insert into public.pedidos (restaurante_id, mesa_id, mesa_nome, numero, observacao, total, precisa_preparo,
    tipo, cliente_nome, cliente_telefone, endereco, forma_pagamento, troco_para, taxa_entrega, acompanhar, cliente_user_id,
    frete_gratis, taxa_entregador)
  values (v_rest.id, null, case when p_tipo = 'delivery' then 'Delivery' else 'Retirada' end, v_numero,
    case when v_rest.loja_obs then nullif(left(trim(p_obs), 300), '') end, v_itens_total + v_taxa, v_preparo,
    p_tipo, v_cli_nome, v_cli_tel, v_end, v_forma, case when v_forma = 'dinheiro' then v_troco end, v_taxa, v_acompanhar, auth.uid(),
    v_gratis, v_corrida)
  returning id into v_pedido;

  insert into public.pedido_itens (pedido_id, restaurante_id, produto_id, nome, preco_unit, qtd, obs, complementos, adicionais, bump_id)
  select v_pedido, v_rest.id, (l ->> 'produto_id')::uuid, l ->> 'nome', (l ->> 'preco')::numeric, (l ->> 'qtd')::int, l ->> 'obs',
    l ->> 'complementos', l -> 'adicionais', nullif(l ->> 'bump_id', '')::uuid
  from jsonb_array_elements(v_todas) l;

  insert into public.movimentos_estoque (restaurante_id, produto_id, delta, motivo, pedido_id, user_id)
  select v_rest.id, (l ->> 'produto_id')::uuid, -((l ->> 'qtd')::int), 'Pedido #' || v_numero, v_pedido, null
  from jsonb_array_elements(v_todas) l where (l ->> 'controla')::boolean;

  perform privado.enviar_conversao(v_pedido, p_cliente ->> 'ua', p_cliente ->> 'url');

  return jsonb_build_object('numero', v_numero, 'acompanhar', v_acompanhar, 'total', v_itens_total + v_taxa, 'frete_gratis', v_gratis);
end $function$;

-- ---------- Balcão (PDV): agora também faz pedido para ENTREGA ----------
create or replace function public.pdv_vender(p_rest uuid, p_itens jsonb, p_dados jsonb)
 returns jsonb language plpgsql security definer set search_path to '' as $function$
declare
  v_modo text := coalesce(p_dados ->> 'modo', 'balcao');
  v_forma text := p_dados ->> 'forma';
  v_desc numeric(10,2) := greatest(coalesce(nullif(p_dados ->> 'desconto', '')::numeric, 0), 0);
  v_recebido numeric(10,2) := nullif(p_dados ->> 'recebido', '')::numeric;
  v_cozinha boolean := coalesce((p_dados ->> 'cozinha')::boolean, false);
  v_cli_nome text := nullif(left(trim(coalesce(p_dados ->> 'cliente_nome', '')), 80), '');
  v_cli_tel text := nullif(regexp_replace(coalesce(p_dados ->> 'cliente_telefone', ''), '\D', '', 'g'), '');
  v_pago_agora boolean := coalesce((p_dados ->> 'pago_agora')::boolean, false);
  v_rest public.restaurantes;
  v_mesa public.mesas;
  v_linhas jsonb;
  v_itens numeric(10,2);
  v_total numeric(10,2);
  v_preparo boolean;
  v_status public.status_pedido;
  v_caixa uuid;
  v_pag uuid;
  v_numero int;
  v_pedido uuid;
  v_end jsonb;
  v_taxa numeric(10,2) := 0;
  v_corrida numeric(10,2);
  v_gratis boolean := false;
begin
  if v_modo not in ('balcao', 'mesa', 'entrega') then raise exception 'Modo inválido'; end if;
  if v_modo in ('balcao', 'entrega') and not public.tem_papel(p_rest, '{dono,gerente,caixa}') then
    raise exception 'Só dono, gerente ou caixa vendem no balcão';
  end if;
  if not public.eh_membro(p_rest) or public.eh_entregador(p_rest) then raise exception 'Sem permissão'; end if;
  if v_desc > 0 and not public.tem_papel(p_rest, '{dono,gerente,caixa}') then raise exception 'Sem permissão para dar desconto'; end if;
  if v_cli_tel is not null and char_length(v_cli_tel) not between 10 and 13 then raise exception 'Telefone do cliente precisa ter DDD'; end if;
  select * into v_rest from public.restaurantes where id = p_rest;

  if v_modo = 'mesa' then
    select * into v_mesa from public.mesas where id = nullif(p_dados ->> 'mesa_id', '')::uuid and restaurante_id = p_rest and ativo;
    if not found then raise exception 'Escolha a mesa'; end if;
  elsif v_modo = 'balcao' or v_pago_agora then
    if v_forma is null or v_forma not in ('dinheiro', 'pix', 'credito', 'debito', 'outro') then raise exception 'Escolha a forma de pagamento'; end if;
    select id into v_caixa from public.caixas where restaurante_id = p_rest and fechado_em is null;
    if v_caixa is null then raise exception 'Abra o caixa antes de vender no balcão'; end if;
  elsif v_forma is not null and v_forma not in ('dinheiro', 'pix', 'credito', 'debito', 'outro') then
    raise exception 'Forma de pagamento inválida';
  end if;

  if v_modo = 'entrega' then
    if v_cli_nome is null then raise exception 'Informe o nome do cliente'; end if;
    if v_cli_tel is null then raise exception 'Informe o WhatsApp do cliente (para o entregador falar com ele)'; end if;
    if nullif(trim(p_dados -> 'endereco' ->> 'rua'), '') is null or nullif(trim(p_dados -> 'endereco' ->> 'numero'), '') is null
       or nullif(trim(p_dados -> 'endereco' ->> 'bairro'), '') is null then
      raise exception 'Informe rua, número e bairro da entrega';
    end if;
    v_end := jsonb_build_object(
      'rua', left(trim(p_dados -> 'endereco' ->> 'rua'), 120),
      'numero', left(trim(p_dados -> 'endereco' ->> 'numero'), 20),
      'bairro', left(trim(p_dados -> 'endereco' ->> 'bairro'), 80),
      'complemento', nullif(left(trim(coalesce(p_dados -> 'endereco' ->> 'complemento', '')), 80), ''),
      'referencia', nullif(left(trim(coalesce(p_dados -> 'endereco' ->> 'referencia', '')), 120), ''));
    -- Taxa: a digitada no caixa ou a calculada pelo endereço
    v_taxa := coalesce(nullif(p_dados ->> 'taxa', '')::numeric, privado.taxa_do_endereco(v_rest, v_end));
    if v_taxa is null then raise exception 'Informe a taxa de entrega'; end if;
    if v_taxa < 0 or v_taxa > 500 then raise exception 'Taxa de entrega inválida'; end if;
    v_corrida := coalesce(v_rest.corrida_fixa, v_taxa);
  end if;

  v_linhas := privado.precificar(p_rest, p_itens);
  select coalesce(sum((l ->> 'preco')::numeric * (l ->> 'qtd')::int), 0), coalesce(bool_or((l ->> 'preparo')::boolean), false)
  into v_itens, v_preparo from jsonb_array_elements(v_linhas) l;
  if v_desc > v_itens then raise exception 'O desconto é maior que o pedido'; end if;
  if v_modo = 'entrega' then
    -- Frete grátis: pelo dia da semana, ou marcado na hora pelo caixa
    v_gratis := coalesce((p_dados ->> 'frete_gratis')::boolean, privado.frete_gratis_hoje(v_rest, v_itens - v_desc));
    if v_gratis then v_taxa := 0; end if;
  end if;
  v_total := v_itens - v_desc + v_taxa;
  if (v_modo = 'balcao' or v_pago_agora) and v_forma = 'dinheiro' and v_recebido is not null and v_recebido < v_total then
    raise exception 'O valor recebido é menor que o total';
  end if;

  v_status := case
    when v_modo = 'mesa' then 'novo'
    when v_modo = 'entrega' then case when v_cozinha then 'novo' else 'pronto' end
    when v_cozinha then 'novo'
    else 'entregue' end;
  update public.restaurantes set ultimo_pedido = ultimo_pedido + 1 where id = p_rest returning ultimo_pedido into v_numero;

  insert into public.pedidos (restaurante_id, mesa_id, mesa_nome, numero, observacao, total, precisa_preparo, status,
    tipo, cliente_nome, cliente_telefone, forma_pagamento, troco_para, desconto, endereco, taxa_entrega, frete_gratis, taxa_entregador)
  values (p_rest, v_mesa.id,
    case when v_modo = 'mesa' then v_mesa.nome when v_modo = 'entrega' then 'Delivery' else 'Balcão' end, v_numero,
    nullif(left(trim(p_dados ->> 'obs'), 300), ''), v_total,
    case when v_modo = 'mesa' then v_preparo else v_cozinha end, v_status,
    case when v_modo = 'mesa' then 'mesa' when v_modo = 'entrega' then 'delivery' else 'balcao' end, v_cli_nome, v_cli_tel,
    case when v_forma in ('dinheiro', 'pix', 'credito', 'debito') then v_forma end,
    case when v_forma = 'dinheiro' then v_recebido end, v_desc, v_end, v_taxa, v_gratis, v_corrida)
  returning id into v_pedido;

  insert into public.pedido_itens (pedido_id, restaurante_id, produto_id, nome, preco_unit, qtd, obs, complementos, adicionais)
  select v_pedido, p_rest, (l ->> 'produto_id')::uuid, l ->> 'nome', (l ->> 'preco')::numeric, (l ->> 'qtd')::int, l ->> 'obs',
    l ->> 'complementos', l -> 'adicionais'
  from jsonb_array_elements(v_linhas) l;

  insert into public.movimentos_estoque (restaurante_id, produto_id, delta, motivo, pedido_id, user_id)
  select p_rest, (l ->> 'produto_id')::uuid, -((l ->> 'qtd')::int), 'Pedido #' || v_numero, v_pedido, (select auth.uid())
  from jsonb_array_elements(v_linhas) l where (l ->> 'controla')::boolean;

  if v_modo = 'balcao' or v_pago_agora then
    insert into public.pagamentos (restaurante_id, caixa_id, mesa_id, mesa_nome, forma, valor)
    values (p_rest, v_caixa, null, case when v_modo = 'entrega' then 'Delivery #' else 'Balcão #' end || v_numero, v_forma, v_total)
    returning id into v_pag;
    update public.pedidos set pago_em = now(), pagamento_id = v_pag where id = v_pedido;
  end if;

  return jsonb_build_object('id', v_pedido, 'numero', v_numero, 'total', v_total, 'frete_gratis', v_gratis, 'taxa', v_taxa,
    'troco', case when v_forma = 'dinheiro' and v_recebido is not null then v_recebido - v_total end);
end $function$;

-- Taxa que o caixa vê ao digitar o bairro no PDV (null = digitar na mão)
create or replace function public.pdv_taxa_entrega(p_rest uuid, p_bairro text, p_itens numeric default 0)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_rest public.restaurantes;
begin
  if not public.tem_papel(p_rest, '{dono,gerente,caixa}') then raise exception 'Sem permissão'; end if;
  select * into v_rest from public.restaurantes where id = p_rest;
  return jsonb_build_object(
    'taxa', privado.taxa_do_endereco(v_rest, jsonb_build_object('bairro', p_bairro)),
    'modo', v_rest.entrega_modo,
    'frete_gratis', privado.frete_gratis_hoje(v_rest, p_itens),
    'corrida_fixa', v_rest.corrida_fixa);
end $$;
grant execute on function public.pdv_taxa_entrega(uuid, text, numeric) to authenticated;

-- ---------- Ações do entregador ----------
create or replace function privado.pedido_entrega(p_pedido uuid)
returns public.pedidos language plpgsql security definer set search_path to '' as $$
declare v public.pedidos;
begin
  select * into v from public.pedidos where id = p_pedido for update;
  if not found or not public.eh_membro(v.restaurante_id) then raise exception 'Pedido não encontrado'; end if;
  if v.tipo <> 'delivery' then raise exception 'Este pedido não é de entrega'; end if;
  if v.status = 'cancelado' then raise exception 'Este pedido foi cancelado'; end if;
  return v;
end $$;

-- Entregador pega a entrega para ele
create or replace function public.entrega_pegar(p_pedido uuid)
returns void language plpgsql security definer set search_path to '' as $$
declare v public.pedidos;
begin
  v := privado.pedido_entrega(p_pedido);
  if not public.eh_entregador(v.restaurante_id) then raise exception 'Só entregadores pegam entregas'; end if;
  if v.entregue_em is not null or v.status = 'entregue' then raise exception 'Este pedido já foi entregue'; end if;
  if v.entregador_id is not null and v.entregador_id <> auth.uid() then
    raise exception 'Outro entregador (%) já pegou esta entrega', coalesce(v.entregador_nome, 'equipe');
  end if;
  update public.pedidos set entregador_id = auth.uid(), entregador_nome = public.nome_membro(v.restaurante_id), atualizado_em = now()
  where id = v.id;
end $$;

-- Entregador desiste (antes de sair)
create or replace function public.entrega_largar(p_pedido uuid)
returns void language plpgsql security definer set search_path to '' as $$
declare v public.pedidos;
begin
  v := privado.pedido_entrega(p_pedido);
  if v.entregador_id is distinct from auth.uid() and not public.tem_papel(v.restaurante_id, '{dono,gerente,caixa}') then
    raise exception 'Esta entrega não é sua';
  end if;
  if v.entregue_em is not null then raise exception 'Este pedido já foi entregue'; end if;
  update public.pedidos set entregador_id = null, entregador_nome = null, saiu_em = null, atualizado_em = now() where id = v.id;
end $$;

-- Saiu para entrega
create or replace function public.entrega_saiu(p_pedido uuid)
returns void language plpgsql security definer set search_path to '' as $$
declare v public.pedidos;
begin
  v := privado.pedido_entrega(p_pedido);
  if v.entregador_id is null and public.eh_entregador(v.restaurante_id) then perform public.entrega_pegar(p_pedido); v := privado.pedido_entrega(p_pedido); end if;
  if v.entregador_id is distinct from auth.uid() and not public.tem_papel(v.restaurante_id, '{dono,gerente,caixa}') then
    raise exception 'Esta entrega não é sua';
  end if;
  if v.entregador_id is null then raise exception 'Escolha o entregador antes'; end if;
  update public.pedidos set saiu_em = coalesce(saiu_em, now()), atualizado_em = now(),
    status = case when status in ('novo', 'preparando') then 'pronto'::public.status_pedido else status end
  where id = v.id;
end $$;

-- Entregue ao cliente
create or replace function public.entrega_concluir(p_pedido uuid)
returns void language plpgsql security definer set search_path to '' as $$
declare v public.pedidos;
begin
  v := privado.pedido_entrega(p_pedido);
  if v.entregador_id is distinct from auth.uid() and not public.tem_papel(v.restaurante_id, '{dono,gerente,caixa}') then
    raise exception 'Esta entrega não é sua';
  end if;
  update public.pedidos set entregue_em = now(), saiu_em = coalesce(saiu_em, now()), status = 'entregue', atualizado_em = now()
  where id = v.id;
end $$;

-- Caixa/gerente escolhe (ou tira) o entregador de um pedido
create or replace function public.entrega_atribuir(p_pedido uuid, p_entregador uuid)
returns void language plpgsql security definer set search_path to '' as $$
declare v public.pedidos; v_nome text;
begin
  v := privado.pedido_entrega(p_pedido);
  if not public.tem_papel(v.restaurante_id, '{dono,gerente,caixa}') then raise exception 'Sem permissão'; end if;
  if p_entregador is null then
    update public.pedidos set entregador_id = null, entregador_nome = null, saiu_em = null, atualizado_em = now() where id = v.id;
    return;
  end if;
  select nome into v_nome from public.membros where restaurante_id = v.restaurante_id and user_id = p_entregador and papel = 'entregador';
  if v_nome is null then raise exception 'Entregador não encontrado'; end if;
  update public.pedidos set entregador_id = p_entregador, entregador_nome = v_nome, atualizado_em = now() where id = v.id;
end $$;

-- Acerto: marca as corridas do entregador como pagas (até agora)
create or replace function public.entregador_acertar(p_rest uuid, p_entregador uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_qtd int; v_total numeric;
begin
  if not public.tem_papel(p_rest, '{dono,gerente,caixa}') then raise exception 'Sem permissão'; end if;
  with u as (
    update public.pedidos set entregador_pago_em = now()
    where restaurante_id = p_rest and entregador_id = p_entregador and entregue_em is not null and entregador_pago_em is null and status = 'entregue'
    returning coalesce(taxa_entregador, 0) as valor
  ) select count(*), coalesce(sum(valor), 0) into v_qtd, v_total from u;
  return jsonb_build_object('qtd', v_qtd, 'total', v_total);
end $$;

grant execute on function public.entrega_pegar(uuid), public.entrega_largar(uuid), public.entrega_saiu(uuid),
  public.entrega_concluir(uuid), public.entrega_atribuir(uuid, uuid), public.entregador_acertar(uuid, uuid) to authenticated;
revoke all on function privado.pedido_entrega(uuid) from public;

-- Entregador não muda status pelo caminho da cozinha (só pelas ações de entrega)
create or replace function public.pedido_mudar_status(p_pedido uuid, p_status public.status_pedido)
 returns void language plpgsql security definer set search_path to '' as $function$
declare
  v public.pedidos;
begin
  select * into v from public.pedidos where id = p_pedido for update;
  if not found or not public.eh_membro(v.restaurante_id) then raise exception 'Pedido não encontrado'; end if;
  if public.eh_entregador(v.restaurante_id) then raise exception 'Use os botões de entrega do app'; end if;
  if v.status = p_status then return; end if;
  if v.status = 'cancelado' then raise exception 'Este pedido já foi cancelado'; end if;

  if p_status = 'cancelado' then
    -- devolve ao estoque o que foi baixado
    with q as (
      select i.produto_id, sum(i.qtd)::int as qtd
      from public.pedido_itens i join public.produtos p on p.id = i.produto_id
      where i.pedido_id = v.id and p.controla_estoque
      group by i.produto_id
    ), u as (
      update public.produtos p set estoque = p.estoque + q.qtd from q where p.id = q.produto_id returning p.id
    )
    insert into public.movimentos_estoque (restaurante_id, produto_id, delta, motivo, pedido_id)
    select v.restaurante_id, q.produto_id, q.qtd, 'Cancelamento do pedido #' || v.numero, v.id from q;
  end if;

  update public.pedidos set status = p_status, atualizado_em = now(),
    entregue_em = case when p_status = 'entregue' and tipo = 'delivery' then coalesce(entregue_em, now()) else entregue_em end
  where id = v.id;
end $function$;

-- ---------- Cardápio digital: mostra o frete grátis ----------
create or replace function public.loja_cardapio(p_codigo text)
 returns jsonb language plpgsql stable security definer set search_path to '' as $function$
declare
  v public.restaurantes;
begin
  select * into v from public.restaurantes where codigo = lower(trim(p_codigo));
  if not found or not v.ativo then raise exception 'Loja não encontrada'; end if;
  return jsonb_build_object(
    'restaurante', jsonb_build_object(
      'id', v.id, 'nome', v.nome, 'slogan', v.slogan, 'logo_url', v.logo_url, 'cor', v.cor,
      'aberto', privado.loja_aberta(v), 'ligado', v.delivery_ativo,
      'taxa', v.delivery_taxa, 'minimo', v.delivery_minimo, 'tempo', v.delivery_tempo,
      'entrega', v.entrega_ativa, 'retirada', v.retirada_ativa, 'whatsapp', v.whatsapp, 'endereco', v.endereco,
      'segmento', v.segmento, 'instagram', v.instagram, 'mapa_url', v.mapa_url, 'capa_url', v.loja_capa_url, 'capa_video_url', v.capa_video_url,
      'descricao', v.loja_descricao, 'rodape', v.loja_rodape, 'obs', v.loja_obs, 'formas', to_jsonb(v.formas_pagamento),
      'horarios', case when v.horarios_ativos then v.horarios end,
      'ads', jsonb_strip_nulls(jsonb_build_object('pixel', v.ads_pixel, 'ga4', v.ads_ga4, 'gads', v.ads_gads)),
      'entrega_modo', v.entrega_modo, 'lat', v.lat, 'lng', v.lng,
      'cidade', nullif(trim(concat_ws('/', v.endereco_info ->> 'cidade', v.endereco_info ->> 'uf')), ''),
      'raios', case when v.entrega_modo = 'raio' then v.entrega_raios end,
      'bairros', case when v.entrega_modo = 'bairro' then (select jsonb_agg(jsonb_build_object('nome', b ->> 'nome', 'taxa', (b ->> 'taxa')::numeric) order by b ->> 'nome') from jsonb_array_elements(v.entrega_bairros) b) end,
      'fidelidade', case when coalesce((v.fidelidade ->> 'ativo')::boolean, false) then jsonb_build_object(
        'meta', coalesce(nullif(v.fidelidade ->> 'meta', '')::int, 10),
        'premio', v.fidelidade ->> 'premio',
        'minimo', coalesce(nullif(v.fidelidade ->> 'minimo', '')::numeric, 0)) end,
      'frete_gratis', case when coalesce(array_length(v.frete_gratis_dias, 1), 0) > 0 then jsonb_build_object(
        'dias', to_jsonb(v.frete_gratis_dias),
        'minimo', v.frete_gratis_minimo,
        'hoje', privado.frete_gratis_hoje(v, 1e9)) end
    )
  ) || privado.cardapio_json(v.id);
end $function$;

-- ---------- Acompanhar pedido: saiu para entrega / entregador / frete grátis ----------
create or replace function public.loja_pedido_status(p_acompanhar text)
 returns jsonb language sql stable security definer set search_path to '' as $function$
  select jsonb_build_object(
    'numero', p.numero, 'status', p.status, 'tipo', p.tipo, 'total', p.total, 'taxa', p.taxa_entrega,
    'criado_em', p.criado_em, 'atualizado_em', p.atualizado_em, 'pago', p.pago_em is not null,
    'forma', p.forma_pagamento, 'troco', p.troco_para, 'endereco', p.endereco, 'cliente', p.cliente_nome,
    'motivo', p.cancel_motivo, 'saiu_em', p.saiu_em, 'entregador', split_part(coalesce(p.entregador_nome, ''), ' ', 1),
    'frete_gratis', p.frete_gratis,
    'itens', (select jsonb_agg(jsonb_build_object('nome', i.nome, 'qtd', i.qtd, 'preco', i.preco_unit, 'complementos', i.complementos) order by i.nome)
              from public.pedido_itens i where i.pedido_id = p.id),
    'cancelados', (select jsonb_agg(jsonb_build_object('nome', c.nome, 'qtd', c.qtd, 'motivo', c.motivo) order by c.criado_em)
                   from public.itens_cancelados c where c.pedido_id = p.id and not c.pedido_inteiro),
    'loja', jsonb_build_object('nome', r.nome, 'logo_url', r.logo_url, 'cor', r.cor, 'whatsapp', r.whatsapp,
                               'endereco', r.endereco, 'codigo', r.codigo, 'tempo', r.delivery_tempo)
  )
  from public.pedidos p join public.restaurantes r on r.id = p.restaurante_id
  where p.acompanhar = p_acompanhar
$function$;

-- ---------- Avisos no celular do entregador ----------
alter table public.push_inscricoes drop constraint if exists push_inscricoes_app_check;
alter table public.push_inscricoes add constraint push_inscricoes_app_check check (app = any (array['garcom', 'dono', 'entregador']));

create or replace function public.push_inscrever(p_rest uuid, p_endpoint text, p_p256dh text, p_auth text, p_app text default 'garcom')
 returns void language plpgsql security definer set search_path to '' as $function$
begin
  if not public.eh_membro(p_rest) then raise exception 'Sem permissão'; end if;
  if p_app not in ('garcom', 'dono', 'entregador') then raise exception 'App inválido'; end if;
  if p_app = 'dono' and not public.tem_papel(p_rest, '{dono}') then raise exception 'Só o dono recebe os avisos de venda'; end if;
  delete from public.push_inscricoes where endpoint = p_endpoint;
  insert into public.push_inscricoes (user_id, restaurante_id, endpoint, p256dh, auth, app)
  values ((select auth.uid()), p_rest, p_endpoint, p_p256dh, p_auth, p_app);
end $function$;

create or replace function privado.notificar_push()
 returns trigger language plpgsql security definer set search_path to '' as $function$
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
        'corpo', case when new.tipo = 'mesa' then 'Pode levar para a mesa.' when new.tipo = 'delivery' then 'Pronto para sair: ' || coalesce(new.endereco ->> 'bairro', 'entrega') || '.' else 'Pode entregar.' end,
        'tag', 'pedido-' || new.id, 'evento', 'pronto');
    elsif new.status = 'entregue' and old.status is distinct from 'entregue' and new.tipo in ('delivery', 'retirada') then
      v_payload := jsonb_build_object(
        'titulo', 'Nova venda! ' || v_valor,
        'corpo', new.mesa_nome || ' #' || new.numero || ' entregue',
        'tag', 'venda-' || new.id, 'evento', 'venda', 'mesa', new.mesa_nome, 'valor', v_valor);
    else
      return new;
    end if;
    v_payload := v_payload || jsonb_build_object('tipo', new.tipo, 'entregador_id', new.entregador_id);
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
