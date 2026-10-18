-- =====================================================================
-- Taxa de entrega por distância (raio) ou por bairro, com mapa
-- Galeria do produto (mais fotos e vídeos) e sugestão de observação
-- =====================================================================

alter table public.restaurantes
  add column entrega_modo text not null default 'fixa' check (entrega_modo in ('fixa', 'raio', 'bairro')),
  add column entrega_raios jsonb not null default '[]'::jsonb,
  add column entrega_bairros jsonb not null default '[]'::jsonb,
  add column lat float8 check (lat between -90 and 90),
  add column lng float8 check (lng between -180 and 180);
grant update (entrega_modo, entrega_raios, entrega_bairros, lat, lng) on public.restaurantes to authenticated;

alter table public.produtos
  add column galeria jsonb not null default '[]'::jsonb check (jsonb_typeof(galeria) = 'array' and jsonb_array_length(galeria) <= 6),
  add column dica_obs text check (char_length(dica_obs) <= 80);
grant update (galeria, dica_obs) on public.produtos to authenticated;

create or replace function privado.cardapio_json(p_rest uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'categorias', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'nome', c.nome, 'emoji', c.emoji, 'pai_id', c.pai_id,
        'grupo_id', c.grupo_id, 'preco_grupo', c.preco_grupo, 'esgotado', c.esgotado
      ) order by c.ordem, c.nome)
      from public.categorias c
      left join public.categorias pai on pai.id = c.pai_id
      where c.restaurante_id = p_rest and c.ativo and (c.pai_id is null or pai.ativo)
    ), '[]'::jsonb),
    'produtos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'categoria_id', p.categoria_id, 'nome', p.nome, 'descricao', p.descricao,
        'preco', p.preco, 'preco_de', case when p.preco_de > p.preco then p.preco_de end,
        'galeria', p.galeria, 'dica_obs', p.dica_obs,
        'emoji', p.emoji, 'imagem_url', p.imagem_url, 'video_url', p.video_url,
        'capa', case when p.capa = 'video' and p.video_url is not null then 'video' else 'imagem' end,
        'vegetariano', p.vegetariano, 'picancia', p.picancia, 'destaque', p.destaque, 'novo', p.novo,
        'disponivel', not p.esgotado and not c.esgotado and ((not p.controla_estoque) or p.estoque > 0),
        'estoque_max', case when p.controla_estoque then p.estoque end
      ) order by p.ordem, p.nome)
      from public.produtos p
      join public.categorias c on c.id = p.categoria_id and c.ativo
      left join public.categorias pai on pai.id = c.pai_id
      where p.restaurante_id = p_rest and p.ativo and (c.pai_id is null or pai.ativo)
    ), '[]'::jsonb),
    'sabores', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'grupo_id', p.grupo_id, 'nome', p.nome, 'descricao', p.descricao,
        'preco', p.preco, 'emoji', p.emoji, 'imagem_url', p.imagem_url, 'video_url', p.video_url,
        'capa', case when p.capa = 'video' and p.video_url is not null then 'video' else 'imagem' end,
        'vegetariano', p.vegetariano, 'picancia', p.picancia, 'destaque', false, 'novo', p.novo,
        'disponivel', not p.esgotado and ((not p.controla_estoque) or p.estoque > 0),
        'estoque_max', case when p.controla_estoque then p.estoque end
      ) order by p.ordem, p.nome)
      from public.produtos p
      where p.restaurante_id = p_rest and p.ativo and p.grupo_id is not null
    ), '[]'::jsonb)
  ) || privado.adicionais_json(p_rest)
$$;

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
      'ads', jsonb_strip_nulls(jsonb_build_object('pixel', v.ads_pixel, 'ga4', v.ads_ga4, 'gads', v.ads_gads)),
      'entrega_modo', v.entrega_modo, 'lat', v.lat, 'lng', v.lng,
      'cidade', nullif(trim(concat_ws('/', v.endereco_info ->> 'cidade', v.endereco_info ->> 'uf')), ''),
      'raios', case when v.entrega_modo = 'raio' then v.entrega_raios end,
      'bairros', case when v.entrega_modo = 'bairro' then (select jsonb_agg(jsonb_build_object('nome', b ->> 'nome', 'taxa', (b ->> 'taxa')::numeric) order by b ->> 'nome') from jsonb_array_elements(v.entrega_bairros) b) end,
      'fidelidade', case when coalesce((v.fidelidade ->> 'ativo')::boolean, false) then jsonb_build_object(
        'meta', coalesce(nullif(v.fidelidade ->> 'meta', '')::int, 10),
        'premio', v.fidelidade ->> 'premio',
        'minimo', coalesce(nullif(v.fidelidade ->> 'minimo', '')::numeric, 0)) end
    )
  ) || privado.cardapio_json(v.id);
end $$;

create or replace function public.loja_pedido_enviar(p_codigo text, p_tipo text, p_itens jsonb, p_cliente jsonb, p_obs text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_rest public.restaurantes;
  v_todas jsonb;
  v_preparo boolean;
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
  if v_forma = 'dinheiro' and v_troco is not null and v_troco < v_itens_total + v_taxa then v_troco := null; end if;

  update public.restaurantes set ultimo_pedido = ultimo_pedido + 1 where id = v_rest.id returning ultimo_pedido into v_numero;

  insert into public.pedidos (restaurante_id, mesa_id, mesa_nome, numero, observacao, total, precisa_preparo,
    tipo, cliente_nome, cliente_telefone, endereco, forma_pagamento, troco_para, taxa_entrega, acompanhar)
  values (v_rest.id, null, case when p_tipo = 'delivery' then 'Delivery' else 'Retirada' end, v_numero,
    case when v_rest.loja_obs then nullif(left(trim(p_obs), 300), '') end, v_itens_total + v_taxa, v_preparo,
    p_tipo, v_cli_nome, v_cli_tel, v_end, v_forma, case when v_forma = 'dinheiro' then v_troco end, v_taxa, v_acompanhar)
  returning id into v_pedido;

  insert into public.pedido_itens (pedido_id, restaurante_id, produto_id, nome, preco_unit, qtd, obs, complementos, adicionais)
  select v_pedido, v_rest.id, (l ->> 'produto_id')::uuid, l ->> 'nome', (l ->> 'preco')::numeric, (l ->> 'qtd')::int, l ->> 'obs',
    l ->> 'complementos', l -> 'adicionais'
  from jsonb_array_elements(v_todas) l;

  insert into public.movimentos_estoque (restaurante_id, produto_id, delta, motivo, pedido_id, user_id)
  select v_rest.id, (l ->> 'produto_id')::uuid, -((l ->> 'qtd')::int), 'Pedido #' || v_numero, v_pedido, null
  from jsonb_array_elements(v_todas) l where (l ->> 'controla')::boolean;

  perform privado.enviar_conversao(v_pedido, p_cliente ->> 'ua', p_cliente ->> 'url');

  return jsonb_build_object('numero', v_numero, 'acompanhar', v_acompanhar, 'total', v_itens_total + v_taxa);
end $$;
