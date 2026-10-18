-- =====================================================================
-- Pedidos balcão (PDV), Configurações em abas (estabelecimento, cardápio
-- digital, clientes, integrações por chave e anúncios)
-- =====================================================================

-- ---------- Estabelecimento e cardápio digital ----------
alter table public.restaurantes
  add column segmento text check (char_length(segmento) <= 40),
  add column instagram text check (char_length(instagram) <= 40),
  add column endereco_info jsonb,
  add column horarios jsonb,
  add column horarios_ativos boolean not null default false,
  add column fuso text not null default 'America/Sao_Paulo' check (char_length(fuso) <= 40),
  add column entrega_ativa boolean not null default true,
  add column formas_pagamento text[] not null default '{pix,dinheiro,credito,debito}'
    check (cardinality(formas_pagamento) > 0 and formas_pagamento <@ array['pix', 'dinheiro', 'credito', 'debito']),
  add column loja_obs boolean not null default true,
  add column loja_capa_url text check (char_length(loja_capa_url) <= 500),
  add column loja_descricao text check (char_length(loja_descricao) <= 300),
  add column loja_rodape text check (char_length(loja_rodape) <= 300),
  -- Anúncios: só os IDs públicos (o token da Conversions API fica em restaurante_dados)
  add column ads_pixel text check (ads_pixel ~ '^[0-9]{5,20}$'),
  add column ads_ga4 text check (ads_ga4 ~ '^G-[A-Z0-9]{4,15}$'),
  add column ads_gads text check (ads_gads ~ '^AW-[0-9]{5,15}$');
grant update (segmento, instagram, endereco_info, horarios, horarios_ativos, fuso, entrega_ativa, formas_pagamento,
  loja_obs, loja_capa_url, loja_descricao, loja_rodape, ads_pixel, ads_ga4, ads_gads)
  on public.restaurantes to authenticated;

-- Dados sensíveis do estabelecimento: só dono e gerente veem (o garçom não)
create table public.restaurante_dados (
  restaurante_id uuid primary key references public.restaurantes on delete cascade,
  responsavel_nome text check (char_length(responsavel_nome) <= 80),
  responsavel_cpf text check (responsavel_cpf ~ '^[0-9]{11}$'),
  responsavel_whatsapp text check (char_length(responsavel_whatsapp) <= 20),
  cnpj text check (cnpj ~ '^[0-9]{14}$'),
  razao_social text check (char_length(razao_social) <= 120),
  capi_token text check (capi_token ~ '^[A-Za-z0-9_-]{20,400}$'),
  atualizado_em timestamptz not null default now()
);
alter table public.restaurante_dados enable row level security;
revoke all on public.restaurante_dados from anon;
revoke delete on public.restaurante_dados from authenticated;
create policy "gestor vê dados" on public.restaurante_dados for select to authenticated using (public.tem_papel(restaurante_id, '{dono,gerente}'));
create policy "gestor cria dados" on public.restaurante_dados for insert to authenticated with check (public.tem_papel(restaurante_id, '{dono,gerente}'));
create policy "gestor edita dados" on public.restaurante_dados for update to authenticated
  using (public.tem_papel(restaurante_id, '{dono,gerente}')) with check (public.tem_papel(restaurante_id, '{dono,gerente}'));

-- ---------- Pedido de balcão ----------
alter table public.pedidos drop constraint pedidos_tipo_check;
alter table public.pedidos add constraint pedidos_tipo_check check (tipo in ('mesa', 'delivery', 'retirada', 'balcao'));
alter table public.pedidos add column desconto numeric(10,2) not null default 0 check (desconto >= 0);

-- ---------- Integrações: chave da API ----------
create table public.api_chaves (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes on delete cascade,
  final text not null,
  hash text not null unique,
  criado_em timestamptz not null default now(),
  criado_por_nome text,
  ultimo_uso timestamptz,
  revogada_em timestamptz
);
create unique index api_chaves_uma_ativa on public.api_chaves (restaurante_id) where revogada_em is null;
alter table public.api_chaves enable row level security;
revoke all on public.api_chaves from anon;
revoke insert, update, delete on public.api_chaves from authenticated;
create policy "gestor vê chaves" on public.api_chaves for select to authenticated using (public.tem_papel(restaurante_id, '{dono,gerente}'));

-- Gera uma chave nova (a antiga para de funcionar). Só aparece inteira agora; o banco guarda o hash.
create function public.api_chave_gerar(p_rest uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_token text := 'bf_' || encode(extensions.gen_random_bytes(24), 'hex');
begin
  if not public.tem_papel(p_rest, '{dono,gerente}') then raise exception 'Sem permissão'; end if;
  update public.api_chaves set revogada_em = now() where restaurante_id = p_rest and revogada_em is null;
  insert into public.api_chaves (restaurante_id, final, hash, criado_por_nome)
  values (p_rest, right(v_token, 4), encode(extensions.digest(v_token, 'sha256'), 'hex'),
    (select nome from public.membros where restaurante_id = p_rest and user_id = (select auth.uid())));
  return v_token;
end $$;

create function public.api_chave_revogar(p_rest uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.tem_papel(p_rest, '{dono,gerente}') then raise exception 'Sem permissão'; end if;
  update public.api_chaves set revogada_em = now() where restaurante_id = p_rest and revogada_em is null;
end $$;

-- Usada pela função "api" (service role) para entregar o cardápio
create function public.api_cardapio(p_rest uuid) returns jsonb
language sql stable security definer set search_path = '' as $$ select privado.cardapio_json(p_rest) $$;

-- ---------- Meus clientes (quem já pediu com telefone) ----------
create function public.clientes_listar(p_rest uuid)
returns table (telefone text, nome text, pedidos bigint, total numeric, primeiro timestamptz, ultimo timestamptz, bairro text)
language sql stable security definer set search_path = '' as $$
  select p.cliente_telefone,
    (array_agg(p.cliente_nome order by p.criado_em desc) filter (where p.cliente_nome is not null))[1],
    count(*), sum(p.total), min(p.criado_em), max(p.criado_em),
    (array_agg(p.endereco ->> 'bairro' order by p.criado_em desc) filter (where p.endereco is not null))[1]
  from public.pedidos p
  where p.restaurante_id = p_rest and p.cliente_telefone is not null and p.status <> 'cancelado'
    and public.tem_papel(p_rest, '{dono,gerente,caixa}')
  group by p.cliente_telefone
  order by max(p.criado_em) desc
$$;

-- ---------- PDV ----------
-- Cardápio para a equipe (mesmo formato do delivery) + quais itens vão para a cozinha
create function public.pdv_cardapio(p_rest uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.eh_membro(p_rest) then raise exception 'Sem permissão'; end if;
  return privado.cardapio_json(p_rest) || jsonb_build_object(
    'preparo', coalesce((select jsonb_agg(id) from public.produtos where restaurante_id = p_rest and ativo and precisa_preparo), '[]'::jsonb));
end $$;

-- Confere cada item, calcula o preço no servidor e baixa o estoque
create function privado.precificar(p_rest uuid, p_itens jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_item jsonb;
  v_prod public.produtos;
  v_cat public.categorias;
  v_qtd int;
  v_nome text;
  v_preco numeric(10,2);
  v_todas jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_itens) is distinct from 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'O pedido está vazio'; end if;
  if jsonb_array_length(p_itens) > 80 then raise exception 'Itens demais em um só pedido'; end if;

  for v_item in select * from jsonb_array_elements(p_itens) loop
    v_qtd := (v_item ->> 'qtd')::int;
    if v_qtd is null or v_qtd < 1 or v_qtd > 99 then raise exception 'Quantidade inválida'; end if;

    select * into v_prod from public.produtos
    where id = (v_item ->> 'produto_id')::uuid and restaurante_id = p_rest and ativo
    for update;
    if not found then raise exception 'Um dos itens não está mais disponível'; end if;
    if v_prod.esgotado then raise exception '"%" esgotou.', v_prod.nome; end if;

    v_nome := v_prod.nome;
    v_preco := v_prod.preco;
    if v_prod.categoria_id is not null then
      select * into v_cat from public.categorias where id = v_prod.categoria_id;
      if v_cat.esgotado then raise exception '"%" esgotou.', v_cat.nome; end if;
      if v_cat.preco_grupo is not null then
        v_nome := v_cat.nome || ' · ' || v_prod.nome;
        v_preco := v_cat.preco_grupo + v_prod.preco;
      end if;
    end if;
    if v_prod.grupo_id is not null then
      select * into v_cat from public.categorias
      where id = nullif(v_item ->> 'categoria_id', '')::uuid and restaurante_id = p_rest and ativo and grupo_id = v_prod.grupo_id;
      if not found then raise exception 'Escolha o tamanho de "%"', v_prod.nome; end if;
      if v_cat.esgotado then raise exception '"%" esgotou.', v_cat.nome; end if;
      v_nome := v_cat.nome || ' · ' || v_prod.nome;
      v_preco := coalesce(v_cat.preco_grupo, 0) + v_prod.preco;
    end if;

    if v_prod.controla_estoque then
      if v_prod.estoque < v_qtd then
        raise exception 'Estoque insuficiente de "%" (restam %)', v_prod.nome, v_prod.estoque;
      end if;
      update public.produtos set estoque = estoque - v_qtd where id = v_prod.id;
    end if;

    v_todas := v_todas || jsonb_build_object(
      'produto_id', v_prod.id, 'nome', v_nome, 'preco', v_preco, 'qtd', v_qtd,
      'obs', nullif(left(trim(v_item ->> 'obs'), 140), ''), 'controla', v_prod.controla_estoque,
      'preparo', v_prod.precisa_preparo
    );
  end loop;
  return v_todas;
end $$;

-- Venda rápida no balcão (paga na hora) ou lançamento na conta de uma mesa
create function public.pdv_vender(p_rest uuid, p_itens jsonb, p_dados jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_modo text := coalesce(p_dados ->> 'modo', 'balcao');
  v_forma text := p_dados ->> 'forma';
  v_desc numeric(10,2) := greatest(coalesce(nullif(p_dados ->> 'desconto', '')::numeric, 0), 0);
  v_recebido numeric(10,2) := nullif(p_dados ->> 'recebido', '')::numeric;
  v_cozinha boolean := coalesce((p_dados ->> 'cozinha')::boolean, false);
  v_cli_nome text := nullif(left(trim(coalesce(p_dados ->> 'cliente_nome', '')), 80), '');
  v_cli_tel text := nullif(regexp_replace(coalesce(p_dados ->> 'cliente_telefone', ''), '\D', '', 'g'), '');
  v_mesa public.mesas;
  v_linhas jsonb;
  v_total numeric(10,2);
  v_preparo boolean;
  v_status public.status_pedido;
  v_caixa uuid;
  v_pag uuid;
  v_numero int;
  v_pedido uuid;
begin
  if v_modo not in ('balcao', 'mesa') then raise exception 'Modo inválido'; end if;
  if v_modo = 'balcao' and not public.tem_papel(p_rest, '{dono,gerente,caixa}') then
    raise exception 'Só dono, gerente ou caixa vendem no balcão';
  end if;
  if not public.eh_membro(p_rest) then raise exception 'Sem permissão'; end if;
  if v_desc > 0 and not public.tem_papel(p_rest, '{dono,gerente,caixa}') then raise exception 'Sem permissão para dar desconto'; end if;
  if v_cli_tel is not null and char_length(v_cli_tel) not between 10 and 13 then raise exception 'Telefone do cliente precisa ter DDD'; end if;

  if v_modo = 'mesa' then
    select * into v_mesa from public.mesas where id = nullif(p_dados ->> 'mesa_id', '')::uuid and restaurante_id = p_rest and ativo;
    if not found then raise exception 'Escolha a mesa'; end if;
  else
    if v_forma is null or v_forma not in ('dinheiro', 'pix', 'credito', 'debito', 'outro') then raise exception 'Escolha a forma de pagamento'; end if;
    select id into v_caixa from public.caixas where restaurante_id = p_rest and fechado_em is null;
    if v_caixa is null then raise exception 'Abra o caixa antes de vender no balcão'; end if;
  end if;

  v_linhas := privado.precificar(p_rest, p_itens);
  select coalesce(sum((l ->> 'preco')::numeric * (l ->> 'qtd')::int), 0), coalesce(bool_or((l ->> 'preparo')::boolean), false)
  into v_total, v_preparo from jsonb_array_elements(v_linhas) l;
  if v_desc > v_total then raise exception 'O desconto é maior que o pedido'; end if;
  v_total := v_total - v_desc;
  if v_modo = 'balcao' and v_forma = 'dinheiro' and v_recebido is not null and v_recebido < v_total then
    raise exception 'O valor recebido é menor que o total';
  end if;

  v_status := case when v_modo = 'mesa' or v_cozinha then 'novo' else 'entregue' end;
  update public.restaurantes set ultimo_pedido = ultimo_pedido + 1 where id = p_rest returning ultimo_pedido into v_numero;

  insert into public.pedidos (restaurante_id, mesa_id, mesa_nome, numero, observacao, total, precisa_preparo, status,
    tipo, cliente_nome, cliente_telefone, forma_pagamento, troco_para, desconto)
  values (p_rest, v_mesa.id, case when v_modo = 'mesa' then v_mesa.nome else 'Balcão' end, v_numero,
    nullif(left(trim(p_dados ->> 'obs'), 300), ''), v_total,
    case when v_modo = 'mesa' then v_preparo else v_cozinha end, v_status,
    case when v_modo = 'mesa' then 'mesa' else 'balcao' end, v_cli_nome, v_cli_tel,
    case when v_forma in ('dinheiro', 'pix', 'credito', 'debito') then v_forma end,
    case when v_forma = 'dinheiro' then v_recebido end, v_desc)
  returning id into v_pedido;

  insert into public.pedido_itens (pedido_id, restaurante_id, produto_id, nome, preco_unit, qtd, obs)
  select v_pedido, p_rest, (l ->> 'produto_id')::uuid, l ->> 'nome', (l ->> 'preco')::numeric, (l ->> 'qtd')::int, l ->> 'obs'
  from jsonb_array_elements(v_linhas) l;

  insert into public.movimentos_estoque (restaurante_id, produto_id, delta, motivo, pedido_id, user_id)
  select p_rest, (l ->> 'produto_id')::uuid, -((l ->> 'qtd')::int), 'Pedido #' || v_numero, v_pedido, (select auth.uid())
  from jsonb_array_elements(v_linhas) l where (l ->> 'controla')::boolean;

  if v_modo = 'balcao' then
    insert into public.pagamentos (restaurante_id, caixa_id, mesa_id, mesa_nome, forma, valor)
    values (p_rest, v_caixa, null, 'Balcão #' || v_numero, v_forma, v_total)
    returning id into v_pag;
    update public.pedidos set pago_em = now(), pagamento_id = v_pag where id = v_pedido;
  end if;

  return jsonb_build_object('id', v_pedido, 'numero', v_numero, 'total', v_total,
    'troco', case when v_forma = 'dinheiro' and v_recebido is not null then v_recebido - v_total end);
end $$;

-- Venda de balcão já entregue não acorda o celular dos garçons (o dono recebe a venda)
create or replace function privado.notificar_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_segredo text;
  v_payload jsonb;
begin
  select valor into v_url from privado.config where chave = 'push_url';
  select valor into v_segredo from privado.config where chave = 'push_segredo';
  if v_url is null then return new; end if;

  if tg_table_name = 'pedidos' then
    if tg_op = 'INSERT' then
      v_payload := jsonb_build_object(
        'titulo', 'Novo pedido #' || new.numero || ' · ' || new.mesa_nome,
        'corpo', 'Total R$ ' || replace(to_char(new.total, 'FM999990.00'), '.', ','),
        'tag', 'pedido-' || new.id,
        'evento', 'venda', 'mesa', new.mesa_nome,
        'valor', 'R$ ' || replace(to_char(new.total, 'FM999990.00'), '.', ','),
        'so_dono', new.tipo = 'balcao' and new.status = 'entregue');
    elsif new.status = 'pronto' and old.status is distinct from 'pronto' then
      v_payload := jsonb_build_object(
        'titulo', 'Pedido #' || new.numero || ' pronto · ' || new.mesa_nome,
        'corpo', case when new.tipo = 'mesa' then 'Pode levar para a mesa.' else 'Pode entregar.' end,
        'tag', 'pedido-' || new.id, 'evento', 'pronto');
    else
      return new;
    end if;
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
end $$;

-- ---------- Cardápio digital: horários, capa, rodapé, formas de pagamento ----------
-- A loja recebe pedidos se estiver ligada e (com horários ativos) dentro do horário de hoje
create function privado.loja_aberta(v public.restaurantes) returns boolean
language plpgsql stable set search_path = '' as $$
declare
  v_agora timestamp := now() at time zone coalesce(v.fuso, 'America/Sao_Paulo');
  v_dia int := extract(dow from v_agora)::int;
  v_hora time := v_agora::time;
  v_h jsonb;
  v_de time;
  v_ate time;
begin
  if not v.delivery_ativo then return false; end if;
  if not v.horarios_ativos or jsonb_typeof(v.horarios) is distinct from 'array' then return true; end if;
  v_h := v.horarios -> v_dia;
  if coalesce((v_h ->> 'aberto')::boolean, false) then
    v_de := (v_h ->> 'de')::time; v_ate := (v_h ->> 'ate')::time;
    if v_ate > v_de and v_hora >= v_de and v_hora < v_ate then return true; end if;
    if v_ate <= v_de and v_hora >= v_de then return true; end if; -- vira a noite
  end if;
  -- Ontem que passou da meia-noite (ex.: 18:00 às 02:00)
  v_h := v.horarios -> ((v_dia + 6) % 7);
  if coalesce((v_h ->> 'aberto')::boolean, false) then
    v_de := (v_h ->> 'de')::time; v_ate := (v_h ->> 'ate')::time;
    if v_ate <= v_de and v_hora < v_ate then return true; end if;
  end if;
  return false;
end $$;

create or replace function public.loja_cardapio(p_codigo text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
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
      'segmento', v.segmento, 'instagram', v.instagram, 'capa_url', v.loja_capa_url,
      'descricao', v.loja_descricao, 'rodape', v.loja_rodape, 'obs', v.loja_obs, 'formas', to_jsonb(v.formas_pagamento),
      'horarios', case when v.horarios_ativos then v.horarios end,
      'ads', jsonb_strip_nulls(jsonb_build_object('pixel', v.ads_pixel, 'ga4', v.ads_ga4, 'gads', v.ads_gads))
    )
  ) || privado.cardapio_json(v.id);
end $$;

-- Conversão para o Facebook (Conversions API), se a loja configurou pixel + token
create function privado.enviar_conversao(p_pedido uuid, p_ua text, p_url text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.pedidos;
  v_pixel text;
  v_token text;
  v_tel text;
  v_nome text;
begin
  select * into v from public.pedidos where id = p_pedido;
  select r.ads_pixel, d.capi_token into v_pixel, v_token
  from public.restaurantes r left join public.restaurante_dados d on d.restaurante_id = r.id
  where r.id = v.restaurante_id;
  if v_pixel is null or v_token is null then return; end if;
  v_tel := case when v.cliente_telefone is null then null when left(v.cliente_telefone, 2) = '55' and char_length(v.cliente_telefone) >= 12 then v.cliente_telefone else '55' || v.cliente_telefone end;
  v_nome := lower(split_part(trim(coalesce(v.cliente_nome, '')), ' ', 1));
  perform net.http_post(
    url := 'https://graph.facebook.com/v21.0/' || v_pixel || '/events?access_token=' || v_token,
    body := jsonb_build_object('data', jsonb_build_array(jsonb_build_object(
      'event_name', 'Purchase',
      'event_time', extract(epoch from v.criado_em)::bigint,
      'event_id', v.acompanhar,
      'action_source', 'website',
      'event_source_url', left(p_url, 500),
      'user_data', jsonb_strip_nulls(jsonb_build_object(
        'ph', case when v_tel is not null then jsonb_build_array(encode(extensions.digest(v_tel, 'sha256'), 'hex')) end,
        'fn', case when v_nome <> '' then jsonb_build_array(encode(extensions.digest(v_nome, 'sha256'), 'hex')) end,
        'country', jsonb_build_array(encode(extensions.digest('br', 'sha256'), 'hex')),
        'client_user_agent', left(p_ua, 400))),
      'custom_data', jsonb_build_object('currency', 'BRL', 'value', v.total)
    ))),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
exception when others then
  return; -- conversão nunca atrapalha o pedido
end $$;

create or replace function public.loja_pedido_enviar(p_codigo text, p_tipo text, p_itens jsonb, p_cliente jsonb, p_obs text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_rest public.restaurantes;
  v_item jsonb;
  v_prod public.produtos;
  v_cat public.categorias;
  v_qtd int;
  v_nome text;
  v_preco numeric(10,2);
  v_linhas jsonb;
  v_todas jsonb := '[]'::jsonb;
  v_preparo boolean := false;
  v_itens_total numeric(10,2);
  v_taxa numeric(10,2) := 0;
  v_numero int;
  v_pedido uuid;
  v_acompanhar text := replace(gen_random_uuid()::text, '-', '');
  v_cli_nome text := nullif(left(trim(p_cliente ->> 'nome'), 80), '');
  v_cli_tel text := nullif(regexp_replace(coalesce(p_cliente ->> 'telefone', ''), '\D', '', 'g'), '');
  v_forma text := p_cliente ->> 'pagamento';
  v_troco numeric(10,2) := nullif(p_cliente ->> 'troco', '')::numeric;
  v_end jsonb := null;
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
  if jsonb_typeof(p_itens) is distinct from 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'O pedido está vazio'; end if;
  if jsonb_array_length(p_itens) > 50 then raise exception 'Itens demais em um só pedido'; end if;
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
    v_taxa := v_rest.delivery_taxa;
  end if;

  for v_item in select * from jsonb_array_elements(p_itens) loop
    v_qtd := (v_item ->> 'qtd')::int;
    if v_qtd is null or v_qtd < 1 or v_qtd > 50 then raise exception 'Quantidade inválida'; end if;

    select * into v_prod from public.produtos
    where id = (v_item ->> 'produto_id')::uuid and restaurante_id = v_rest.id and ativo
    for update;
    if not found then raise exception 'Um dos itens não está mais disponível'; end if;
    if v_prod.esgotado then raise exception '"%" esgotou. Escolha outra opção.', v_prod.nome; end if;

    v_nome := v_prod.nome;
    v_preco := v_prod.preco;
    if v_prod.categoria_id is not null then
      select * into v_cat from public.categorias where id = v_prod.categoria_id;
      if v_cat.esgotado then raise exception '"%" esgotou. Escolha outra opção.', v_cat.nome; end if;
      if v_cat.preco_grupo is not null then
        v_nome := v_cat.nome || ' · ' || v_prod.nome;
        v_preco := v_cat.preco_grupo + v_prod.preco;
      end if;
    end if;
    if v_prod.grupo_id is not null then
      select * into v_cat from public.categorias
      where id = nullif(v_item ->> 'categoria_id', '')::uuid and restaurante_id = v_rest.id
        and ativo and grupo_id = v_prod.grupo_id;
      if not found then raise exception 'Escolha o tamanho de "%"', v_prod.nome; end if;
      if v_cat.esgotado then raise exception '"%" esgotou. Escolha outra opção.', v_cat.nome; end if;
      v_nome := v_cat.nome || ' · ' || v_prod.nome;
      v_preco := coalesce(v_cat.preco_grupo, 0) + v_prod.preco;
    end if;

    if v_prod.controla_estoque then
      if v_prod.estoque < v_qtd then
        raise exception 'Estoque insuficiente de "%" (restam %)', v_prod.nome, v_prod.estoque;
      end if;
      update public.produtos set estoque = estoque - v_qtd where id = v_prod.id;
    end if;

    v_linhas := jsonb_build_object(
      'produto_id', v_prod.id, 'nome', v_nome, 'preco', v_preco, 'qtd', v_qtd,
      'obs', case when v_rest.loja_obs then nullif(left(trim(v_item ->> 'obs'), 140), '') end, 'controla', v_prod.controla_estoque
    );
    v_todas := v_todas || v_linhas;
    v_preparo := v_preparo or v_prod.precisa_preparo;
  end loop;

  select coalesce(sum((l ->> 'preco')::numeric * (l ->> 'qtd')::int), 0) into v_itens_total from jsonb_array_elements(v_todas) l;
  if v_itens_total < v_rest.delivery_minimo then
    raise exception 'O pedido mínimo é de R$ %', replace(to_char(v_rest.delivery_minimo, 'FM999990.00'), '.', ',');
  end if;
  if v_forma = 'dinheiro' and v_troco is not null and v_troco < v_itens_total + v_taxa then v_troco := null; end if;

  update public.restaurantes set ultimo_pedido = ultimo_pedido + 1 where id = v_rest.id returning ultimo_pedido into v_numero;

  insert into public.pedidos (restaurante_id, mesa_id, mesa_nome, numero, observacao, total, precisa_preparo,
    tipo, cliente_nome, cliente_telefone, endereco, forma_pagamento, troco_para, taxa_entrega, acompanhar)
  values (v_rest.id, null, case when p_tipo = 'delivery' then 'Delivery' else 'Retirada' end, v_numero,
    case when v_rest.loja_obs then nullif(left(trim(p_obs), 300), '') end, v_itens_total + v_taxa, v_preparo,
    p_tipo, v_cli_nome, v_cli_tel, v_end, v_forma, case when v_forma = 'dinheiro' then v_troco end, v_taxa, v_acompanhar)
  returning id into v_pedido;

  insert into public.pedido_itens (pedido_id, restaurante_id, produto_id, nome, preco_unit, qtd, obs)
  select v_pedido, v_rest.id, (l ->> 'produto_id')::uuid, l ->> 'nome', (l ->> 'preco')::numeric, (l ->> 'qtd')::int, l ->> 'obs'
  from jsonb_array_elements(v_todas) l;

  insert into public.movimentos_estoque (restaurante_id, produto_id, delta, motivo, pedido_id, user_id)
  select v_rest.id, (l ->> 'produto_id')::uuid, -((l ->> 'qtd')::int), 'Pedido #' || v_numero, v_pedido, null
  from jsonb_array_elements(v_todas) l where (l ->> 'controla')::boolean;

  perform privado.enviar_conversao(v_pedido, p_cliente ->> 'ua', p_cliente ->> 'url');

  return jsonb_build_object('numero', v_numero, 'acompanhar', v_acompanhar, 'total', v_itens_total + v_taxa);
end $$;

-- ---------- Permissões ----------
revoke execute on function public.api_chave_gerar(uuid), public.api_chave_revogar(uuid), public.api_cardapio(uuid),
  public.clientes_listar(uuid), public.pdv_cardapio(uuid), public.pdv_vender(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.api_chave_gerar(uuid), public.api_chave_revogar(uuid),
  public.clientes_listar(uuid), public.pdv_cardapio(uuid), public.pdv_vender(uuid, jsonb, jsonb) to authenticated;
revoke execute on function public.api_cardapio(uuid) from authenticated;
grant execute on function public.api_cardapio(uuid) to service_role;
revoke execute on function privado.precificar(uuid, jsonb), privado.loja_aberta(public.restaurantes),
  privado.enviar_conversao(uuid, text, text) from public;
