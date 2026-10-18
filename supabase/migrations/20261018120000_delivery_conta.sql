-- =====================================================================
-- Cardápio digital para DELIVERY (/loja/<codigo>) + Minha conta (plano e faturas)
-- =====================================================================

-- Configuração do delivery no restaurante
alter table public.restaurantes
  add column delivery_ativo boolean not null default false,
  add column delivery_taxa numeric(10,2) not null default 0 check (delivery_taxa >= 0),
  add column delivery_minimo numeric(10,2) not null default 0 check (delivery_minimo >= 0),
  add column delivery_tempo text not null default '40 a 60 min' check (char_length(delivery_tempo) <= 30),
  add column retirada_ativa boolean not null default true,
  add column whatsapp text check (char_length(whatsapp) <= 20),
  add column endereco text check (char_length(endereco) <= 200),
  -- Plano (preenchido pela plataforma)
  add column plano_valor numeric(10,2),
  add column plano_vence_em date,
  add column plano_forma text check (char_length(plano_forma) <= 40);
grant update (delivery_ativo, delivery_taxa, delivery_minimo, delivery_tempo, retirada_ativa, whatsapp, endereco)
  on public.restaurantes to authenticated;

-- Pedido de casa: quem é, onde entrega, como paga
alter table public.pedidos
  add column tipo text not null default 'mesa' check (tipo in ('mesa', 'delivery', 'retirada')),
  add column cliente_nome text check (char_length(cliente_nome) <= 80),
  add column cliente_telefone text check (char_length(cliente_telefone) <= 20),
  add column endereco jsonb,
  add column forma_pagamento text check (forma_pagamento in ('dinheiro', 'pix', 'credito', 'debito')),
  add column troco_para numeric(10,2),
  add column taxa_entrega numeric(10,2) not null default 0,
  add column acompanhar text unique;

-- Faturas do plano (criadas pela plataforma; o restaurante só vê)
create table public.faturas (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes on delete cascade,
  referencia text not null check (char_length(referencia) <= 40),
  valor numeric(10,2) not null check (valor >= 0),
  vencimento date not null,
  pago_em timestamptz,
  link text check (char_length(link) <= 500),
  criado_em timestamptz not null default now()
);
create index on public.faturas (restaurante_id, vencimento desc);
alter table public.faturas enable row level security;
create policy "dono vê faturas" on public.faturas for select to authenticated
  using (public.tem_papel(restaurante_id, '{dono}') or public.eh_admin_plataforma());
create policy "plataforma cria faturas" on public.faturas for insert to authenticated with check (public.eh_admin_plataforma());
create policy "plataforma edita faturas" on public.faturas for update to authenticated using (public.eh_admin_plataforma()) with check (public.eh_admin_plataforma());
create policy "plataforma apaga faturas" on public.faturas for delete to authenticated using (public.eh_admin_plataforma());

-- Cardápio (categorias, produtos e sabores) de um restaurante
create function privado.cardapio_json(p_rest uuid) returns jsonb
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
        'preco', p.preco, 'emoji', p.emoji, 'imagem_url', p.imagem_url, 'video_url', p.video_url,
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
  )
$$;

-- Vitrine do delivery: dados da loja + cardápio
create function public.loja_cardapio(p_codigo text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v public.restaurantes;
begin
  select * into v from public.restaurantes where codigo = lower(trim(p_codigo));
  if not found or not v.ativo then raise exception 'Loja não encontrada'; end if;
  return jsonb_build_object(
    'restaurante', jsonb_build_object(
      'id', v.id, 'nome', v.nome, 'slogan', v.slogan, 'logo_url', v.logo_url, 'cor', v.cor,
      'aberto', v.delivery_ativo, 'taxa', v.delivery_taxa, 'minimo', v.delivery_minimo, 'tempo', v.delivery_tempo,
      'retirada', v.retirada_ativa, 'whatsapp', v.whatsapp, 'endereco', v.endereco
    )
  ) || privado.cardapio_json(v.id);
end $$;

-- Pedido feito em casa (delivery ou retirada no balcão)
create function public.loja_pedido_enviar(p_codigo text, p_tipo text, p_itens jsonb, p_cliente jsonb, p_obs text default null) returns jsonb
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
  if not v_rest.delivery_ativo then raise exception 'A loja está fechada para pedidos agora'; end if;
  if p_tipo not in ('delivery', 'retirada') then raise exception 'Escolha entrega ou retirada'; end if;
  if p_tipo = 'retirada' and not v_rest.retirada_ativa then raise exception 'Esta loja não faz retirada no balcão'; end if;
  if v_cli_nome is null then raise exception 'Informe seu nome'; end if;
  if v_cli_tel is null or char_length(v_cli_tel) not between 10 and 13 then raise exception 'Informe um telefone com DDD'; end if;
  if v_forma not in ('dinheiro', 'pix', 'credito', 'debito') then raise exception 'Escolha a forma de pagamento'; end if;
  if jsonb_typeof(p_itens) is distinct from 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'O pedido está vazio'; end if;
  if jsonb_array_length(p_itens) > 50 then raise exception 'Itens demais em um só pedido'; end if;
  -- Proteção contra trote: no máximo 3 pedidos em aberto do mesmo telefone em 30 minutos
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
      -- Item de subcategoria com preço (ex.: Pizza P R$ 50): vale o preço dela + o acréscimo do item
      select * into v_cat from public.categorias where id = v_prod.categoria_id;
      if v_cat.esgotado then raise exception '"%" esgotou. Escolha outra opção.', v_cat.nome; end if;
      if v_cat.preco_grupo is not null then
        v_nome := v_cat.nome || ' · ' || v_prod.nome;
        v_preco := v_cat.preco_grupo + v_prod.preco;
      end if;
    end if;
    if v_prod.grupo_id is not null then
      -- Sabor: só vale dentro de um tamanho ligado ao grupo dele
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
      'obs', nullif(left(trim(v_item ->> 'obs'), 140), ''), 'controla', v_prod.controla_estoque
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
    nullif(left(trim(p_obs), 300), ''), v_itens_total + v_taxa, v_preparo,
    p_tipo, v_cli_nome, v_cli_tel, v_end, v_forma, case when v_forma = 'dinheiro' then v_troco end, v_taxa, v_acompanhar)
  returning id into v_pedido;

  insert into public.pedido_itens (pedido_id, restaurante_id, produto_id, nome, preco_unit, qtd, obs)
  select v_pedido, v_rest.id, (l ->> 'produto_id')::uuid, l ->> 'nome', (l ->> 'preco')::numeric, (l ->> 'qtd')::int, l ->> 'obs'
  from jsonb_array_elements(v_todas) l;

  insert into public.movimentos_estoque (restaurante_id, produto_id, delta, motivo, pedido_id, user_id)
  select v_rest.id, (l ->> 'produto_id')::uuid, -((l ->> 'qtd')::int), 'Pedido #' || v_numero, v_pedido, null
  from jsonb_array_elements(v_todas) l where (l ->> 'controla')::boolean;

  return jsonb_build_object('numero', v_numero, 'acompanhar', v_acompanhar, 'total', v_itens_total + v_taxa);
end $$;

-- Acompanhar o pedido (o link fica com o cliente)
create function public.loja_pedido_status(p_acompanhar text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'numero', p.numero, 'status', p.status, 'tipo', p.tipo, 'total', p.total, 'taxa', p.taxa_entrega,
    'criado_em', p.criado_em, 'atualizado_em', p.atualizado_em, 'pago', p.pago_em is not null,
    'forma', p.forma_pagamento, 'troco', p.troco_para, 'endereco', p.endereco, 'cliente', p.cliente_nome,
    'itens', (select jsonb_agg(jsonb_build_object('nome', i.nome, 'qtd', i.qtd, 'preco', i.preco_unit) order by i.nome)
              from public.pedido_itens i where i.pedido_id = p.id),
    'loja', jsonb_build_object('nome', r.nome, 'logo_url', r.logo_url, 'cor', r.cor, 'whatsapp', r.whatsapp,
                               'endereco', r.endereco, 'codigo', r.codigo, 'tempo', r.delivery_tempo)
  )
  from public.pedidos p join public.restaurantes r on r.id = p.restaurante_id
  where p.acompanhar = p_acompanhar
$$;

-- Receber o pagamento de um pedido de delivery/retirada (sem mesa)
create function public.pedido_receber(p_pedido uuid, p_forma text) returns numeric
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.pedidos;
  v_caixa uuid;
  v_pag uuid;
begin
  select * into v from public.pedidos where id = p_pedido;
  if not found or not public.tem_papel(v.restaurante_id, '{dono,gerente,caixa}') then raise exception 'Sem permissão para receber'; end if;
  if v.mesa_id is not null then raise exception 'Pedido de mesa: receba pela conta da mesa'; end if;
  if v.pago_em is not null then raise exception 'Este pedido já foi pago'; end if;
  if v.status = 'cancelado' then raise exception 'Pedido cancelado'; end if;
  if p_forma not in ('dinheiro', 'pix', 'credito', 'debito', 'outro') then raise exception 'Forma de pagamento inválida'; end if;
  select id into v_caixa from public.caixas where restaurante_id = v.restaurante_id and fechado_em is null;
  if v_caixa is null then raise exception 'Abra o caixa antes de receber pagamentos'; end if;
  insert into public.pagamentos (restaurante_id, caixa_id, mesa_id, mesa_nome, forma, valor)
  values (v.restaurante_id, v_caixa, null, v.mesa_nome || ' #' || v.numero, p_forma, v.total)
  returning id into v_pag;
  update public.pedidos set pago_em = now(), pagamento_id = v_pag where id = p_pedido;
  return v.total;
end $$;

revoke execute on function public.loja_cardapio(text), public.loja_pedido_enviar(text, text, jsonb, jsonb, text),
  public.loja_pedido_status(text), public.pedido_receber(uuid, text) from public;
grant execute on function public.loja_cardapio(text), public.loja_pedido_enviar(text, text, jsonb, jsonb, text),
  public.loja_pedido_status(text) to anon, authenticated;
grant execute on function public.pedido_receber(uuid, text) to authenticated;
