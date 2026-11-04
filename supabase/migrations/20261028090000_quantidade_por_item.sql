-- Quantidade de escolhas por item: o mesmo grupo "Sabores" ligado à Pizza P (até 1),
-- M (até 2) e G (até 3), ou ao pastel. Vazio = usa o mínimo/máximo do grupo.
alter table public.produto_adicionais
  add column minimo int check (minimo between 0 and 50),
  add column maximo int check (maximo between 1 and 50),
  add constraint produto_adicionais_regra_ck check ((minimo is null) = (maximo is null) and (minimo is null or minimo <= maximo));

CREATE OR REPLACE FUNCTION privado.precificar(p_rest uuid, p_itens jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_bump public.order_bumps;
  v_min int;
  v_max int;
begin
  if jsonb_typeof(p_itens) is distinct from 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'O pedido está vazio'; end if;
  if jsonb_array_length(p_itens) > 80 then raise exception 'Itens demais em um só pedido'; end if;

  -- Trava os produtos em ordem fixa (por id) antes de tudo: evita deadlock com pedidos simultâneos
  perform 1 from public.produtos
  where restaurante_id = p_rest
    and id in (select (e ->> 'produto_id')::uuid from jsonb_array_elements(p_itens) e where e ? 'produto_id')
  order by id
  for no key update;

  for v_item in select * from jsonb_array_elements(p_itens) loop
    v_qtd := (v_item ->> 'qtd')::int;
    if v_qtd is null or v_qtd < 1 or v_qtd > 99 then raise exception 'Quantidade inválida'; end if;

    select * into v_prod from public.produtos
    where id = (v_item ->> 'produto_id')::uuid and restaurante_id = p_rest and ativo
    for no key update;
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
    -- Order bump: só itens da oferta, sem adicionais, junto com outro item; aplica o desconto
    v_bump := null;
    if nullif(v_item ->> 'bump_id', '') is not null then
      select * into v_bump from public.order_bumps
      where id = (v_item ->> 'bump_id')::uuid and restaurante_id = p_rest and ativo;
      if not found or (v_bump.ofertas_modo = 'manual' and not (v_prod.id = any (v_bump.ofertas))) then
        raise exception 'A oferta de "%" acabou. Remova o item e adicione de novo.', v_prod.nome;
      end if;
      if jsonb_array_length(coalesce(v_item -> 'adicionais', '[]'::jsonb)) > 0 then raise exception 'Oferta inválida'; end if;
      if v_qtd > v_bump.max_qtd then
        raise exception 'A oferta de "%" vale para até % %', v_prod.nome, v_bump.max_qtd, case when v_bump.max_qtd = 1 then 'unidade' else 'unidades' end;
      end if;
      if not exists (select 1 from jsonb_array_elements(p_itens) o where nullif(o ->> 'bump_id', '') is null) then
        raise exception 'A oferta de "%" vale junto com outro item do pedido', v_prod.nome;
      end if;
      v_preco := greatest(0, case v_bump.desconto_tipo
        when 'percentual' then round(v_preco * (1 - least(v_bump.desconto_valor, 100) / 100), 2)
        when 'valor' then v_preco - v_bump.desconto_valor
        else v_preco end);
    end if;

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
      -- Quantidade própria deste item (ex.: Pizza G até 3 sabores) ou a do grupo
      select coalesce(pa.minimo, v_grupo.minimo), coalesce(pa.maximo, v_grupo.maximo) into v_min, v_max
      from public.produto_adicionais pa where pa.produto_id = v_prod.id and pa.grupo_id = v_grupo.id;
      v_grupo.minimo := v_min; v_grupo.maximo := v_max;
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
      'preparo', v_prod.precisa_preparo, 'bump_id', v_bump.id,
      'complementos', nullif(left(array_to_string(v_textos, ' · '), 600), ''),
      'adicionais', case when jsonb_array_length(v_escolhidos) > 0 then v_escolhidos end
    );
  end loop;
  return v_todas;
end $function$;

CREATE OR REPLACE FUNCTION privado.adicionais_json(p_rest uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    ), '{}'::jsonb),
    -- Itens com quantidade própria num grupo: { produto: { grupo: { minimo, maximo } } }
    'produto_regras', coalesce((
      select jsonb_object_agg(x.produto_id, x.regras)
      from (
        select pa.produto_id, jsonb_object_agg(pa.grupo_id, jsonb_build_object('minimo', pa.minimo, 'maximo', pa.maximo)) as regras
        from public.produto_adicionais pa
        where pa.restaurante_id = p_rest and pa.maximo is not null
        group by pa.produto_id
      ) x
    ), '{}'::jsonb)
  )
$function$;

CREATE OR REPLACE FUNCTION privado.cardapio_json(p_rest uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with prod as (
    select p.*, c.esgotado as cat_esgotada,
      -- Preço zerado sem outra fonte de preço: não pode ser vendido
      (p.preco <= 0 and c.preco_grupo is null and c.grupo_id is null
        and not exists (select 1 from public.produto_adicionais pa join public.adicional_grupos g on g.id = pa.grupo_id
                        where pa.produto_id = p.id and coalesce(pa.minimo, g.minimo) >= 1)) as sem_preco
    from public.produtos p
    join public.categorias c on c.id = p.categoria_id and c.ativo
    left join public.categorias pai on pai.id = c.pai_id
    where p.restaurante_id = p_rest and p.ativo and (c.pai_id is null or pai.ativo)
  )
  select jsonb_build_object(
    'ocultar_esgotados', coalesce((select r.esgotados_modo = 'ocultar' from public.restaurantes r where r.id = p_rest), false),
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
        'disponivel', not p.sem_preco and not p.esgotado and not p.cat_esgotada and ((not p.controla_estoque) or p.estoque > 0),
        'motivo', case when p.sem_preco then 'sem_preco'
                       when p.esgotado or p.cat_esgotada or (p.controla_estoque and p.estoque <= 0) then 'esgotado' end,
        'estoque_max', case when p.controla_estoque then p.estoque end
      ) order by p.ordem, p.nome)
      from prod p
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
  ) || privado.adicionais_json(p_rest) || privado.bumps_json(p_rest)
$function$;

CREATE OR REPLACE FUNCTION privado.copiar_produtos(p_de uuid, p_para uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    insert into public.produto_adicionais (produto_id, grupo_id, restaurante_id, ordem, minimo, maximo)
    select v_novo, grupo_id, restaurante_id, ordem, minimo, maximo from public.produto_adicionais where produto_id = v.id;
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.produto_duplicar(p_produto uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  insert into public.produto_adicionais (produto_id, grupo_id, restaurante_id, ordem, minimo, maximo)
  select v_novo, grupo_id, restaurante_id, ordem, minimo, maximo from public.produto_adicionais where produto_id = v.id;
  return v_novo;
end $function$;
