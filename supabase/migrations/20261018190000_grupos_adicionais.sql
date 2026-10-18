-- =====================================================================
-- Grupos de adicionais (como no Anota AI): um grupo (ex.: "Sabores", mín. 1,
-- máx. 3) com opções e preço próprio, ligado a vários produtos (Pizza P, M, G).
-- =====================================================================

create table public.adicional_grupos (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes on delete cascade,
  nome text not null check (char_length(trim(nome)) between 1 and 60),
  identificador text check (char_length(identificador) <= 60),
  minimo int not null default 0 check (minimo between 0 and 50),
  maximo int not null default 1 check (maximo between 1 and 50),
  -- Como o preço das opções entra no item: soma de tudo, a mais cara (pizza meio a meio) ou a média
  calculo text not null default 'soma' check (calculo in ('soma', 'maior', 'media')),
  esgotado boolean not null default false,
  ordem int not null default 0,
  criado_em timestamptz not null default now(),
  check (minimo <= maximo)
);
create index on public.adicional_grupos (restaurante_id);

create table public.adicionais (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references public.adicional_grupos on delete cascade,
  restaurante_id uuid not null references public.restaurantes on delete cascade,
  nome text not null check (char_length(trim(nome)) between 1 and 80),
  descricao text check (char_length(descricao) <= 200),
  preco numeric(10,2) not null default 0 check (preco >= 0),
  imagem_url text check (char_length(imagem_url) <= 500),
  -- pode escolher mais de uma unidade da mesma opção (ex.: 2x bacon)
  repetir boolean not null default false,
  esgotado boolean not null default false,
  ordem int not null default 0
);
create index on public.adicionais (grupo_id);
create index on public.adicionais (restaurante_id);

create table public.produto_adicionais (
  produto_id uuid not null references public.produtos on delete cascade,
  grupo_id uuid not null references public.adicional_grupos on delete cascade,
  restaurante_id uuid not null references public.restaurantes on delete cascade,
  ordem int not null default 0,
  primary key (produto_id, grupo_id)
);
create index on public.produto_adicionais (grupo_id);
create index on public.produto_adicionais (restaurante_id);

alter table public.adicional_grupos enable row level security;
alter table public.adicionais enable row level security;
alter table public.produto_adicionais enable row level security;
revoke all on public.adicional_grupos, public.adicionais, public.produto_adicionais from anon;

create policy "ver grupos de adicionais" on public.adicional_grupos for select to authenticated using (public.eh_membro(restaurante_id));
create policy "gestor cria grupos de adicionais" on public.adicional_grupos for insert to authenticated with check (public.tem_papel(restaurante_id, '{dono,gerente}'));
create policy "gestor edita grupos de adicionais" on public.adicional_grupos for update to authenticated using (public.tem_papel(restaurante_id, '{dono,gerente}')) with check (public.tem_papel(restaurante_id, '{dono,gerente}'));
create policy "gestor apaga grupos de adicionais" on public.adicional_grupos for delete to authenticated using (public.tem_papel(restaurante_id, '{dono,gerente}'));

-- Opção e vínculo: o grupo/produto precisa ser do mesmo restaurante
create function public.grupo_do_restaurante(p_grupo uuid, p_rest uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.adicional_grupos where id = p_grupo and restaurante_id = p_rest)
$$;
create function public.produto_do_restaurante(p_produto uuid, p_rest uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.produtos where id = p_produto and restaurante_id = p_rest)
$$;
revoke execute on function public.grupo_do_restaurante(uuid, uuid), public.produto_do_restaurante(uuid, uuid) from public, anon;
grant execute on function public.grupo_do_restaurante(uuid, uuid), public.produto_do_restaurante(uuid, uuid) to authenticated;

create policy "ver adicionais" on public.adicionais for select to authenticated using (public.eh_membro(restaurante_id));
create policy "gestor cria adicionais" on public.adicionais for insert to authenticated
  with check (public.tem_papel(restaurante_id, '{dono,gerente}') and public.grupo_do_restaurante(grupo_id, restaurante_id));
create policy "gestor edita adicionais" on public.adicionais for update to authenticated
  using (public.tem_papel(restaurante_id, '{dono,gerente}'))
  with check (public.tem_papel(restaurante_id, '{dono,gerente}') and public.grupo_do_restaurante(grupo_id, restaurante_id));
create policy "gestor apaga adicionais" on public.adicionais for delete to authenticated using (public.tem_papel(restaurante_id, '{dono,gerente}'));

create policy "ver vínculos de adicionais" on public.produto_adicionais for select to authenticated using (public.eh_membro(restaurante_id));
create policy "gestor vincula adicionais" on public.produto_adicionais for insert to authenticated
  with check (public.tem_papel(restaurante_id, '{dono,gerente}') and public.grupo_do_restaurante(grupo_id, restaurante_id)
    and public.produto_do_restaurante(produto_id, restaurante_id));
create policy "gestor edita vínculos" on public.produto_adicionais for update to authenticated
  using (public.tem_papel(restaurante_id, '{dono,gerente}')) with check (public.tem_papel(restaurante_id, '{dono,gerente}'));
create policy "gestor desvincula adicionais" on public.produto_adicionais for delete to authenticated using (public.tem_papel(restaurante_id, '{dono,gerente}'));

-- Item do pedido guarda o que foi escolhido (estruturado e em texto pronto para mostrar/imprimir)
alter table public.pedido_itens
  add column complementos text check (char_length(complementos) <= 600),
  add column adicionais jsonb;

-- ---------- Cardápio (mesa, delivery e PDV) com os grupos ----------
create function privado.adicionais_json(p_rest uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'adicionais_grupos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id, 'nome', g.nome, 'minimo', g.minimo, 'maximo', g.maximo, 'calculo', g.calculo,
        'opcoes', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', a.id, 'nome', a.nome, 'descricao', a.descricao, 'preco', a.preco, 'imagem_url', a.imagem_url,
            'repetir', a.repetir, 'disponivel', not a.esgotado and not g.esgotado
          ) order by a.ordem, a.nome)
          from public.adicionais a where a.grupo_id = g.id
        ), '[]'::jsonb)
      ) order by g.ordem, g.nome)
      from public.adicional_grupos g where g.restaurante_id = p_rest
    ), '[]'::jsonb),
    'produto_grupos', coalesce((
      select jsonb_object_agg(x.produto_id, x.grupos)
      from (
        select pa.produto_id, jsonb_agg(pa.grupo_id order by pa.ordem, g.nome) as grupos
        from public.produto_adicionais pa join public.adicional_grupos g on g.id = pa.grupo_id
        where pa.restaurante_id = p_rest
        group by pa.produto_id
      ) x
    ), '{}'::jsonb)
  )
$$;

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
  ) || privado.adicionais_json(p_rest)
$$;

create or replace function public.mesa_cardapio(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_mesa public.mesas;
  v_rest public.restaurantes;
begin
  select * into v_mesa from public.mesas where token = p_token and ativo;
  if not found then raise exception 'Mesa não encontrada'; end if;
  select * into v_rest from public.restaurantes where id = v_mesa.restaurante_id;
  if not v_rest.ativo then raise exception 'Restaurante indisponível no momento'; end if;
  return jsonb_build_object(
    'restaurante', jsonb_build_object('id', v_rest.id, 'nome', v_rest.nome, 'slogan', v_rest.slogan, 'logo_url', v_rest.logo_url, 'cor', v_rest.cor),
    'mesa', jsonb_build_object('id', v_mesa.id, 'nome', v_mesa.nome)
  ) || privado.cardapio_json(v_rest.id);
end $$;

-- ---------- Preço no servidor, agora com os adicionais ----------
create or replace function privado.precificar(p_rest uuid, p_itens jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_item jsonb;
  v_prod public.produtos;
  v_cat public.categorias;
  v_grupo public.adicional_grupos;
  v_op record;
  v_qtd int;
  v_nome text;
  v_preco numeric(10,2);
  v_escolha jsonb;
  v_total_g int;
  v_extra numeric(10,2);
  v_soma numeric(10,2);
  v_maior numeric(10,2);
  v_partes text[];
  v_textos text[];
  v_escolhidos jsonb;
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
      where id = nullif(v_item ->> 'categoria_id', '')::uuid and restaurante_id = p_rest and ativo and grupo_id = v_prod.grupo_id;
      if not found then raise exception 'Escolha o tamanho de "%"', v_prod.nome; end if;
      if v_cat.esgotado then raise exception '"%" esgotou. Escolha outra opção.', v_cat.nome; end if;
      v_nome := v_cat.nome || ' · ' || v_prod.nome;
      v_preco := coalesce(v_cat.preco_grupo, 0) + v_prod.preco;
    end if;

    -- Adicionais: só de grupos ligados a este produto, respeitando mínimo e máximo
    v_escolha := coalesce(v_item -> 'adicionais', '[]'::jsonb);
    if jsonb_typeof(v_escolha) <> 'array' then raise exception 'Adicionais inválidos'; end if;
    if exists (
      select 1 from jsonb_array_elements(v_escolha) e
      where not exists (
        select 1 from public.adicionais a join public.produto_adicionais pa on pa.grupo_id = a.grupo_id
        where a.id = (e ->> 'id')::uuid and pa.produto_id = v_prod.id and a.restaurante_id = p_rest
      )
    ) then raise exception 'Um dos adicionais de "%" não está mais disponível', v_prod.nome; end if;

    v_textos := '{}';
    v_escolhidos := '[]'::jsonb;
    for v_grupo in
      select g.* from public.produto_adicionais pa join public.adicional_grupos g on g.id = pa.grupo_id
      where pa.produto_id = v_prod.id order by pa.ordem, g.nome
    loop
      v_total_g := 0; v_soma := 0; v_maior := 0; v_partes := '{}';
      for v_op in
        select a.id, a.nome, a.preco, a.repetir, a.esgotado, sum(greatest(coalesce((e ->> 'qtd')::int, 1), 1))::int as qtd
        from jsonb_array_elements(v_escolha) e join public.adicionais a on a.id = (e ->> 'id')::uuid
        where a.grupo_id = v_grupo.id
        group by a.id, a.nome, a.preco, a.repetir, a.esgotado, a.ordem
        order by a.ordem, a.nome
      loop
        if v_op.esgotado or v_grupo.esgotado then raise exception '"%" esgotou. Escolha outra opção.', v_op.nome; end if;
        if v_op.qtd > 1 and not v_op.repetir then raise exception 'Escolha "%" só uma vez', v_op.nome; end if;
        v_total_g := v_total_g + v_op.qtd;
        v_soma := v_soma + v_op.preco * v_op.qtd;
        v_maior := greatest(v_maior, v_op.preco);
        v_escolhidos := v_escolhidos || jsonb_build_object('id', v_op.id, 'grupo', v_grupo.nome, 'nome', v_op.nome, 'qtd', v_op.qtd, 'preco', v_op.preco);
        v_partes := v_partes || (case when v_op.qtd > 1 then v_op.qtd || 'x ' else '' end || v_op.nome);
      end loop;
      if v_total_g < v_grupo.minimo then
        raise exception 'Escolha % em "%" (%)', case when v_grupo.minimo = 1 then '1 opção' else 'pelo menos ' || v_grupo.minimo || ' opções' end, v_grupo.nome, v_prod.nome;
      end if;
      if v_total_g > v_grupo.maximo then raise exception 'No máximo % em "%"', v_grupo.maximo, v_grupo.nome; end if;
      if v_total_g > 0 then
        v_extra := case v_grupo.calculo
          when 'maior' then v_maior
          when 'media' then round(v_soma / v_total_g, 2)
          else v_soma end;
        v_preco := v_preco + v_extra;
        -- Meio a meio: "1/2 Calabresa, 1/2 Frango"
        if v_grupo.calculo <> 'soma' and v_total_g > 1 then
          select array_agg(case when (x ->> 'qtd')::int = v_total_g then x ->> 'nome' else (x ->> 'qtd') || '/' || v_total_g || ' ' || (x ->> 'nome') end)
          into v_partes
          from jsonb_array_elements(v_escolhidos) x where x ->> 'grupo' = v_grupo.nome;
        end if;
        v_textos := v_textos || (v_grupo.nome || ': ' || array_to_string(v_partes, ', '));
      end if;
    end loop;

    if v_prod.controla_estoque then
      if v_prod.estoque < v_qtd then
        raise exception 'Estoque insuficiente de "%" (restam %)', v_prod.nome, v_prod.estoque;
      end if;
      update public.produtos set estoque = estoque - v_qtd where id = v_prod.id;
    end if;

    v_todas := v_todas || jsonb_build_object(
      'produto_id', v_prod.id, 'nome', v_nome, 'preco', v_preco, 'qtd', v_qtd,
      'obs', nullif(left(trim(v_item ->> 'obs'), 140), ''), 'controla', v_prod.controla_estoque,
      'preparo', v_prod.precisa_preparo,
      'complementos', nullif(left(array_to_string(v_textos, ' · '), 600), ''),
      'adicionais', case when jsonb_array_length(v_escolhidos) > 0 then v_escolhidos end
    );
  end loop;
  return v_todas;
end $$;

-- Mesa: mesmo cálculo; um pedido para a cozinha e outro para o que já sai pronto
create or replace function public.mesa_criar_pedido(p_token text, p_itens jsonb, p_obs text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_mesa public.mesas;
  v_rest public.restaurantes;
  v_todas jsonb;
  v_grupo boolean;
  v_linhas jsonb;
  v_total numeric(10,2);
  v_numero int;
  v_pedido uuid;
  v_ids jsonb := '[]'::jsonb;
  v_numeros jsonb := '[]'::jsonb;
  v_soma numeric(10,2) := 0;
begin
  select * into v_mesa from public.mesas where token = p_token and ativo;
  if not found then raise exception 'Mesa não encontrada'; end if;
  select * into v_rest from public.restaurantes where id = v_mesa.restaurante_id;
  if not v_rest.ativo then raise exception 'Restaurante indisponível no momento'; end if;
  if jsonb_typeof(p_itens) = 'array' and jsonb_array_length(p_itens) > 50 then raise exception 'Itens demais em um só pedido'; end if;

  v_todas := privado.precificar(v_rest.id, p_itens);

  foreach v_grupo in array array[true, false] loop
    select coalesce(jsonb_agg(l), '[]'::jsonb) into v_linhas from jsonb_array_elements(v_todas) l where (l ->> 'preparo')::boolean = v_grupo;
    continue when jsonb_array_length(v_linhas) = 0;

    select coalesce(sum((l ->> 'preco')::numeric * (l ->> 'qtd')::int), 0) into v_total from jsonb_array_elements(v_linhas) l;
    update public.restaurantes set ultimo_pedido = ultimo_pedido + 1 where id = v_rest.id returning ultimo_pedido into v_numero;

    insert into public.pedidos (restaurante_id, mesa_id, mesa_nome, numero, observacao, total, precisa_preparo)
    values (v_rest.id, v_mesa.id, v_mesa.nome, v_numero, nullif(left(trim(p_obs), 300), ''), v_total, v_grupo)
    returning id into v_pedido;

    insert into public.pedido_itens (pedido_id, restaurante_id, produto_id, nome, preco_unit, qtd, obs, complementos, adicionais)
    select v_pedido, v_rest.id, (l ->> 'produto_id')::uuid, l ->> 'nome', (l ->> 'preco')::numeric, (l ->> 'qtd')::int, l ->> 'obs',
      l ->> 'complementos', l -> 'adicionais'
    from jsonb_array_elements(v_linhas) l;

    insert into public.movimentos_estoque (restaurante_id, produto_id, delta, motivo, pedido_id, user_id)
    select v_rest.id, (l ->> 'produto_id')::uuid, -((l ->> 'qtd')::int), 'Pedido #' || v_numero, v_pedido, null
    from jsonb_array_elements(v_linhas) l where (l ->> 'controla')::boolean;

    v_ids := v_ids || to_jsonb(v_pedido);
    v_numeros := v_numeros || to_jsonb(v_numero);
    v_soma := v_soma + v_total;
  end loop;

  return jsonb_build_object('id', v_ids -> 0, 'numero', (v_numeros -> 0)::int, 'numeros', v_numeros, 'ids', v_ids, 'total', v_soma);
end $$;
revoke execute on function public.mesa_criar_pedido(text, jsonb, text) from public, anon, authenticated;

-- Delivery: mesmo cálculo
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
    v_taxa := v_rest.delivery_taxa;
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

-- PDV: grava também os adicionais
create or replace function public.pdv_vender(p_rest uuid, p_itens jsonb, p_dados jsonb) returns jsonb
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

  insert into public.pedido_itens (pedido_id, restaurante_id, produto_id, nome, preco_unit, qtd, obs, complementos, adicionais)
  select v_pedido, p_rest, (l ->> 'produto_id')::uuid, l ->> 'nome', (l ->> 'preco')::numeric, (l ->> 'qtd')::int, l ->> 'obs',
    l ->> 'complementos', l -> 'adicionais'
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

-- Conta da mesa e acompanhamento do delivery mostram os adicionais
create or replace function public.mesa_conta(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
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
    ), 0)
  );
end $$;

create or replace function public.loja_pedido_status(p_acompanhar text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'numero', p.numero, 'status', p.status, 'tipo', p.tipo, 'total', p.total, 'taxa', p.taxa_entrega,
    'criado_em', p.criado_em, 'atualizado_em', p.atualizado_em, 'pago', p.pago_em is not null,
    'forma', p.forma_pagamento, 'troco', p.troco_para, 'endereco', p.endereco, 'cliente', p.cliente_nome,
    'itens', (select jsonb_agg(jsonb_build_object('nome', i.nome, 'qtd', i.qtd, 'preco', i.preco_unit, 'complementos', i.complementos) order by i.nome)
              from public.pedido_itens i where i.pedido_id = p.id),
    'loja', jsonb_build_object('nome', r.nome, 'logo_url', r.logo_url, 'cor', r.cor, 'whatsapp', r.whatsapp,
                               'endereco', r.endereco, 'codigo', r.codigo, 'tempo', r.delivery_tempo)
  )
  from public.pedidos p join public.restaurantes r on r.id = p.restaurante_id
  where p.acompanhar = p_acompanhar
$$;

-- Duplicar leva junto os grupos de adicionais ligados ao item
create or replace function privado.copiar_produtos(p_de uuid, p_para uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.produtos;
  v_novo uuid;
begin
  for v in select * from public.produtos where categoria_id = p_de loop
    insert into public.produtos (restaurante_id, categoria_id, nome, descricao, preco, emoji, imagem_url, vegetariano, picancia,
      destaque, novo, ativo, ordem, controla_estoque, estoque, estoque_minimo, video_url, precisa_preparo, capa, grupo_id, esgotado)
    values (v.restaurante_id, p_para, v.nome, v.descricao, v.preco, v.emoji, v.imagem_url, v.vegetariano, v.picancia,
      v.destaque, v.novo, v.ativo, v.ordem, v.controla_estoque, 0, v.estoque_minimo, v.video_url, v.precisa_preparo, v.capa, v.grupo_id, false)
    returning id into v_novo;
    insert into public.produto_adicionais (produto_id, grupo_id, restaurante_id, ordem)
    select v_novo, grupo_id, restaurante_id, ordem from public.produto_adicionais where produto_id = v.id;
  end loop;
end $$;

create or replace function public.produto_duplicar(p_produto uuid) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.produtos;
  v_novo uuid;
begin
  select * into v from public.produtos where id = p_produto;
  if not found or not public.tem_papel(v.restaurante_id, '{dono,gerente}') then raise exception 'Sem permissão'; end if;
  insert into public.produtos (restaurante_id, categoria_id, nome, descricao, preco, emoji, imagem_url, vegetariano, picancia,
    destaque, novo, ativo, ordem, controla_estoque, estoque, estoque_minimo, video_url, precisa_preparo, capa, grupo_id, esgotado)
  values (v.restaurante_id, v.categoria_id, left(v.nome || ' (cópia)', 80), v.descricao, v.preco, v.emoji, v.imagem_url, v.vegetariano, v.picancia,
    v.destaque, v.novo, v.ativo, v.ordem, v.controla_estoque, 0, v.estoque_minimo, v.video_url, v.precisa_preparo, v.capa, v.grupo_id, false)
  returning id into v_novo;
  insert into public.produto_adicionais (produto_id, grupo_id, restaurante_id, ordem)
  select v_novo, grupo_id, restaurante_id, ordem from public.produto_adicionais where produto_id = v.id;
  return v_novo;
end $$;

revoke execute on function privado.adicionais_json(uuid) from public;
