-- =====================================================================
-- Promoções ("de R$ X por R$ Y") e programa de fidelidade do delivery
-- =====================================================================

-- Preço "de" (riscado): se for maior que o preço, o item está em promoção
alter table public.produtos add column preco_de numeric(10,2) check (preco_de is null or preco_de > 0);
grant update (preco_de) on public.produtos to authenticated;

-- Fidelidade: { ativo, meta (pedidos), premio (texto), minimo (valor do pedido para contar) }
alter table public.restaurantes add column fidelidade jsonb not null default '{}'::jsonb;
grant update (fidelidade) on public.restaurantes to authenticated;

create table public.fidelidade_resgates (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes on delete cascade,
  telefone text not null check (telefone ~ '^[0-9]{10,13}$'),
  premio text check (char_length(premio) <= 120),
  por_nome text,
  criado_em timestamptz not null default now()
);
create index on public.fidelidade_resgates (restaurante_id, telefone, criado_em desc);
alter table public.fidelidade_resgates enable row level security;
revoke all on public.fidelidade_resgates from anon;
revoke insert, update, delete on public.fidelidade_resgates from authenticated;
create policy "equipe vê resgates" on public.fidelidade_resgates for select to authenticated using (public.tem_papel(restaurante_id, '{dono,gerente,caixa}'));

-- Quantos pedidos contam para o prêmio desde o último resgate
create function privado.fidelidade_pontos(p_rest uuid, p_telefone text) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.pedidos p, public.restaurantes r
  where r.id = p_rest and p.restaurante_id = p_rest and p.cliente_telefone = p_telefone and p.status <> 'cancelado'
    and p.tipo in ('delivery', 'retirada', 'balcao')
    and p.total >= coalesce(nullif(r.fidelidade ->> 'minimo', '')::numeric, 0)
    and p.criado_em > coalesce((select max(f.criado_em) from public.fidelidade_resgates f where f.restaurante_id = p_rest and f.telefone = p_telefone), '-infinity')
$$;

-- Cliente vê o cartão de fidelidade pelo telefone que usou nos pedidos
create function public.loja_fidelidade(p_codigo text, p_telefone text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v public.restaurantes;
  v_tel text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
begin
  select * into v from public.restaurantes where codigo = lower(trim(p_codigo)) and ativo;
  if not found then raise exception 'Loja não encontrada'; end if;
  if not coalesce((v.fidelidade ->> 'ativo')::boolean, false) then return jsonb_build_object('ativo', false); end if;
  if char_length(v_tel) not between 10 and 13 then raise exception 'Informe o telefone com DDD'; end if;
  return jsonb_build_object(
    'ativo', true,
    'pontos', privado.fidelidade_pontos(v.id, v_tel),
    'resgates', (select count(*) from public.fidelidade_resgates where restaurante_id = v.id and telefone = v_tel)
  );
end $$;

-- Caixa entrega o prêmio: zera a contagem do cliente
create function public.fidelidade_resgatar(p_rest uuid, p_telefone text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.restaurantes;
  v_meta int;
begin
  if not public.tem_papel(p_rest, '{dono,gerente,caixa}') then raise exception 'Sem permissão'; end if;
  select * into v from public.restaurantes where id = p_rest;
  v_meta := coalesce(nullif(v.fidelidade ->> 'meta', '')::int, 10);
  if privado.fidelidade_pontos(p_rest, p_telefone) < v_meta then raise exception 'O cliente ainda não completou o cartão'; end if;
  insert into public.fidelidade_resgates (restaurante_id, telefone, premio, por_nome)
  values (p_rest, p_telefone, left(v.fidelidade ->> 'premio', 120),
    (select nome from public.membros where restaurante_id = p_rest and user_id = (select auth.uid())));
end $$;

-- Meus clientes mostra a fidelidade
drop function public.clientes_listar(uuid);
create function public.clientes_listar(p_rest uuid)
returns table (telefone text, nome text, pedidos bigint, total numeric, primeiro timestamptz, ultimo timestamptz, bairro text, fidelidade int)
language sql stable security definer set search_path = '' as $$
  select p.cliente_telefone,
    (array_agg(p.cliente_nome order by p.criado_em desc) filter (where p.cliente_nome is not null))[1],
    count(*), sum(p.total), min(p.criado_em), max(p.criado_em),
    (array_agg(p.endereco ->> 'bairro' order by p.criado_em desc) filter (where p.endereco is not null))[1],
    privado.fidelidade_pontos(p_rest, p.cliente_telefone)
  from public.pedidos p
  where p.restaurante_id = p_rest and p.cliente_telefone is not null and p.status <> 'cancelado'
    and public.tem_papel(p_rest, '{dono,gerente,caixa}')
  group by p.cliente_telefone
  order by max(p.criado_em) desc
$$;

-- Cardápio com o preço "de"
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

-- Vitrine do delivery leva a fidelidade (sem dados de ninguém)
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
      'fidelidade', case when coalesce((v.fidelidade ->> 'ativo')::boolean, false) then jsonb_build_object(
        'meta', coalesce(nullif(v.fidelidade ->> 'meta', '')::int, 10),
        'premio', v.fidelidade ->> 'premio',
        'minimo', coalesce(nullif(v.fidelidade ->> 'minimo', '')::numeric, 0)) end
    )
  ) || privado.cardapio_json(v.id);
end $$;

revoke execute on function public.loja_fidelidade(text, text), public.fidelidade_resgatar(uuid, text), public.clientes_listar(uuid) from public;
grant execute on function public.loja_fidelidade(text, text) to anon, authenticated;
grant execute on function public.fidelidade_resgatar(uuid, text), public.clientes_listar(uuid) to authenticated;
revoke execute on function privado.fidelidade_pontos(uuid, text) from public;
