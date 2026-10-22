-- Alavancar vendas › Order bump: oferta que aparece no cardápio (mesa e delivery) logo depois
-- que o cliente escolhe um item, antes de ir para o carrinho.
--   Onde aparece (gatilho): todos os itens, categorias, itens escolhidos, palavras-chave
--   (nome/descrição/categoria do item) ou automático.
--   O que oferece: itens escolhidos ou automático (mais pedidos junto / mais vendidos).
--   Desconto opcional (% ou R$), garantido no servidor pelo privado.precificar.

create table if not exists public.order_bumps (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  nome text not null check (char_length(btrim(nome)) between 1 and 60),
  titulo text not null check (char_length(btrim(titulo)) between 1 and 90),
  subtitulo text check (subtitulo is null or char_length(subtitulo) <= 160),
  ativo boolean not null default true,
  prioridade int not null default 0,
  gatilho text not null default 'automatico' check (gatilho in ('todos', 'categorias', 'produtos', 'palavras', 'automatico')),
  gatilho_categorias uuid[] not null default '{}',
  gatilho_produtos uuid[] not null default '{}',
  gatilho_palavras text[] not null default '{}',
  ofertas_modo text not null default 'manual' check (ofertas_modo in ('manual', 'automatico')),
  ofertas uuid[] not null default '{}',
  max_ofertas int not null default 3 check (max_ofertas between 1 and 6),
  desconto_tipo text not null default 'nenhum' check (desconto_tipo in ('nenhum', 'percentual', 'valor')),
  desconto_valor numeric(10,2) not null default 0 check (desconto_valor >= 0),
  canais text[] not null default '{mesa,delivery}',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (desconto_tipo <> 'percentual' or desconto_valor <= 100)
);
create index if not exists order_bumps_rest_idx on public.order_bumps (restaurante_id, prioridade);

alter table public.order_bumps enable row level security;
revoke all on public.order_bumps from anon;
grant select, insert, update, delete on public.order_bumps to authenticated;
drop policy if exists "equipe vê order bumps" on public.order_bumps;
drop policy if exists "gestor cria order bumps" on public.order_bumps;
drop policy if exists "gestor edita order bumps" on public.order_bumps;
drop policy if exists "gestor apaga order bumps" on public.order_bumps;
create policy "equipe vê order bumps" on public.order_bumps for select to authenticated using (public.eh_membro(restaurante_id));
create policy "gestor cria order bumps" on public.order_bumps for insert to authenticated with check (public.tem_papel(restaurante_id, '{dono,gerente}'));
create policy "gestor edita order bumps" on public.order_bumps for update to authenticated
  using (public.tem_papel(restaurante_id, '{dono,gerente}')) with check (public.tem_papel(restaurante_id, '{dono,gerente}'));
create policy "gestor apaga order bumps" on public.order_bumps for delete to authenticated using (public.tem_papel(restaurante_id, '{dono,gerente}'));

-- Quantas vezes cada oferta apareceu (por dia, para a taxa de conversão do período)
create table if not exists public.order_bump_exibicoes (
  bump_id uuid not null references public.order_bumps(id) on delete cascade,
  dia date not null default current_date,
  qtd int not null default 0,
  primary key (bump_id, dia)
);
alter table public.order_bump_exibicoes enable row level security;
revoke all on public.order_bump_exibicoes from anon, authenticated;

-- Item vendido pela oferta
alter table public.pedido_itens add column if not exists bump_id uuid references public.order_bumps(id) on delete set null;
create index if not exists pedido_itens_bump_idx on public.pedido_itens (bump_id) where bump_id is not null;

-- O cliente viu a oferta (cardápio público)
create or replace function public.bump_exibido(p_bump uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.order_bump_exibicoes (bump_id, dia, qtd)
  select b.id, (now() at time zone 'America/Sao_Paulo')::date, 1 from public.order_bumps b where b.id = p_bump and b.ativo
  on conflict (bump_id, dia) do update set qtd = public.order_bump_exibicoes.qtd + 1;
$$;
revoke all on function public.bump_exibido(uuid) from public;
grant execute on function public.bump_exibido(uuid) to anon, authenticated;

-- Resultado de cada oferta no período (painel › Alavancar vendas)
create or replace function public.bumps_resumo(p_rest uuid, p_inicio timestamptz, p_fim timestamptz)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.eh_membro(p_rest) then raise exception 'Sem permissão'; end if;
  return coalesce((
    select jsonb_object_agg(b.id, jsonb_build_object(
      'exibicoes', coalesce((select sum(e.qtd) from public.order_bump_exibicoes e
                             where e.bump_id = b.id and e.dia >= (p_inicio at time zone 'America/Sao_Paulo')::date
                               and e.dia < (p_fim at time zone 'America/Sao_Paulo')::date + 1), 0),
      'pedidos', coalesce(v.pedidos, 0), 'itens', coalesce(v.itens, 0), 'receita', coalesce(v.receita, 0)))
    from public.order_bumps b
    left join lateral (
      select count(distinct i.pedido_id) as pedidos, sum(i.qtd) as itens, sum(i.preco_unit * i.qtd) as receita
      from public.pedido_itens i join public.pedidos p on p.id = i.pedido_id
      where i.bump_id = b.id and p.status <> 'cancelado' and p.criado_em >= p_inicio and p.criado_em < p_fim
    ) v on true
    where b.restaurante_id = p_rest
  ), '{}'::jsonb);
end $$;
revoke all on function public.bumps_resumo(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.bumps_resumo(uuid, timestamptz, timestamptz) to authenticated;

-- Sugestões automáticas: o que mais sai junto com cada item e os mais vendidos (90 dias)
create or replace function privado.bump_sugestoes(p_rest uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with itens as (
    select i.pedido_id, i.produto_id, i.qtd
    from public.pedido_itens i join public.pedidos p on p.id = i.pedido_id
    where p.restaurante_id = p_rest and p.criado_em > now() - interval '90 days' and p.status <> 'cancelado' and i.produto_id is not null
  ),
  pares as (
    select a.produto_id as a, b.produto_id as b, count(distinct a.pedido_id) as n
    from itens a join itens b on b.pedido_id = a.pedido_id and b.produto_id <> a.produto_id
    group by 1, 2
  ),
  topo as (select a, b, row_number() over (partition by a order by n desc) as r from pares)
  select jsonb_build_object(
    'juntos', coalesce((select jsonb_object_agg(x.a, x.l) from (select a, jsonb_agg(b order by r) as l from topo where r <= 8 group by a) x), '{}'::jsonb),
    'mais_vendidos', coalesce((select jsonb_agg(y.produto_id order by y.q desc) from (select produto_id, sum(qtd) as q from itens group by 1 order by 2 desc limit 16) y), '[]'::jsonb)
  )
$$;

create or replace function privado.bumps_json(p_rest uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'bumps', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'titulo', b.titulo, 'subtitulo', b.subtitulo, 'gatilho', b.gatilho,
        'categorias', b.gatilho_categorias, 'produtos', b.gatilho_produtos, 'palavras', b.gatilho_palavras,
        'ofertas_modo', b.ofertas_modo, 'ofertas', b.ofertas, 'max_ofertas', b.max_ofertas,
        'desconto_tipo', b.desconto_tipo, 'desconto_valor', b.desconto_valor, 'canais', b.canais
      ) order by b.prioridade, b.criado_em)
      from public.order_bumps b where b.restaurante_id = p_rest and b.ativo
    ), '[]'::jsonb),
    'bump_auto', case
      when exists (select 1 from public.order_bumps b where b.restaurante_id = p_rest and b.ativo and (b.ofertas_modo = 'automatico' or b.gatilho = 'automatico'))
      then privado.bump_sugestoes(p_rest) else '{}'::jsonb end
  )
$$;

-- Cardápio (mesa e delivery) passa a levar as ofertas
do $$
declare d text;
begin
  d := pg_get_functiondef('privado.cardapio_json(uuid)'::regprocedure);
  if position('bumps_json' in d) = 0 then
    d := replace(d, '|| privado.adicionais_json(p_rest)', '|| privado.adicionais_json(p_rest) || privado.bumps_json(p_rest)');
    if position('bumps_json' in d) = 0 then raise exception 'cardapio_json: trecho não encontrado'; end if;
    execute d;
  end if;
end $$;

-- Preço da oferta (com desconto) validado no servidor
do $$
declare d text;
begin
  d := pg_get_functiondef('privado.precificar(uuid, jsonb)'::regprocedure);
  if position('v_bump' in d) = 0 then
    d := replace(d, $a$v_todas jsonb := '[]'::jsonb;$a$, $a$v_todas jsonb := '[]'::jsonb;
  v_bump public.order_bumps;$a$);
    d := replace(d, $a$    v_escolha := coalesce(v_item -> 'adicionais', '[]'::jsonb);$a$, $a$    -- Order bump: só itens da oferta, sem adicionais, junto com outro item; aplica o desconto
    v_bump := null;
    if nullif(v_item ->> 'bump_id', '') is not null then
      select * into v_bump from public.order_bumps
      where id = (v_item ->> 'bump_id')::uuid and restaurante_id = p_rest and ativo;
      if not found or (v_bump.ofertas_modo = 'manual' and not (v_prod.id = any (v_bump.ofertas))) then
        raise exception 'A oferta de "%" acabou. Remova o item e adicione de novo.', v_prod.nome;
      end if;
      if jsonb_array_length(coalesce(v_item -> 'adicionais', '[]'::jsonb)) > 0 or v_qtd > 20 then raise exception 'Oferta inválida'; end if;
      if not exists (select 1 from jsonb_array_elements(p_itens) o where nullif(o ->> 'bump_id', '') is null) then
        raise exception 'A oferta de "%" vale junto com outro item do pedido', v_prod.nome;
      end if;
      v_preco := greatest(0, case v_bump.desconto_tipo
        when 'percentual' then round(v_preco * (1 - least(v_bump.desconto_valor, 100) / 100), 2)
        when 'valor' then v_preco - v_bump.desconto_valor
        else v_preco end);
    end if;

    v_escolha := coalesce(v_item -> 'adicionais', '[]'::jsonb);$a$);
    d := replace(d, $a$'preparo', v_prod.precisa_preparo,$a$, $a$'preparo', v_prod.precisa_preparo, 'bump_id', v_bump.id,$a$);
    if (length(d) - length(replace(d, 'v_bump', ''))) / 6 < 8 then raise exception 'precificar: trechos não encontrados'; end if;
    execute d;
  end if;
end $$;

-- Pedidos da mesa e do delivery gravam de qual oferta veio cada item
do $$
declare
  f text;
  d text;
begin
  foreach f in array array['public.mesa_criar_pedido(text, jsonb, text)', 'public.loja_pedido_enviar(text, text, jsonb, jsonb, text)'] loop
    d := pg_get_functiondef(f::regprocedure);
    if position('bump_id' in d) = 0 then
      d := replace(d, 'complementos, adicionais)', 'complementos, adicionais, bump_id)');
      d := regexp_replace(d, $r$l -> 'adicionais'(\s+from jsonb_array_elements\(v_(todas|linhas)\) l;)$r$, $r$l -> 'adicionais', nullif(l ->> 'bump_id', '')::uuid\1$r$);
      if (length(d) - length(replace(d, 'bump_id', ''))) / 7 < 2 then raise exception '%: trechos não encontrados', f; end if;
      execute d;
    end if;
  end loop;
end $$;
