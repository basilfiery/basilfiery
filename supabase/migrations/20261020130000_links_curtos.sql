-- Links curtos e organizados:
--   basilfiery.com.br/<loja>          → cardápio digital (delivery/retirada)
--   basilfiery.com.br/<loja>/<mesa>   → cardápio da mesa (ex.: /basilfiery/mesa1)
-- Os links antigos (/loja/<codigo> e /mesa/<token>) continuam funcionando.

create or replace function privado.slugificar(p text)
returns text language sql immutable as $$
  select trim(both '-' from regexp_replace(
    translate(lower(coalesce(p, '')),
      'áàâãäåéèêëíìîïóòôõöúùûüçñý',
      'aaaaaaeeeeiiiiooooouuuucny'),
    '[^a-z0-9]+', '-', 'g'))
$$;

-- Endereços do próprio sistema não podem virar nome de loja
create or replace function privado.slug_reservado(p text)
returns boolean language sql immutable as $$
  select p = any (array[
    'loja','mesa','login','entrar','cadastro','termos','privacidade','dono','g','garcom','garcons','lista','colaboradores',
    'plataforma','painel','admin','app','apps','api','assets','cardapio','delivery','pedido','pedidos','suporte','ajuda',
    'contato','planos','precos','blog','www','site','basil','sw','manifest','versao','static','public','conta','perfil'
  ])
$$;

alter table public.restaurantes add column if not exists slug text;

-- Escolhe um endereço livre a partir do nome (pizzaria-do-ze, pizzaria-do-ze-2, …)
create or replace function privado.slug_livre(p_nome text, p_id uuid)
returns text language plpgsql as $$
declare
  base text := left(privado.slugificar(p_nome), 36);
  tentativa text;
  n int := 1;
begin
  if length(base) < 3 or privado.slug_reservado(base) then base := 'loja-' || coalesce(nullif(base, ''), 'nova'); end if;
  tentativa := base;
  while exists (select 1 from public.restaurantes where slug = tentativa and id <> p_id) loop
    n := n + 1;
    tentativa := base || '-' || n;
  end loop;
  return tentativa;
end $$;

update public.restaurantes set slug = 'basilfiery' where slug is null and lower(nome) = 'basil fiery';
update public.restaurantes set slug = privado.slug_livre(nome, id) where slug is null;

alter table public.restaurantes alter column slug set not null;
alter table public.restaurantes add constraint restaurantes_slug_key unique (slug);
alter table public.restaurantes add constraint restaurantes_slug_formato check (
  slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 40 and not privado.slug_reservado(slug)
);

-- Loja nova já nasce com endereço
create or replace function privado.restaurante_slug()
returns trigger language plpgsql as $$
begin
  if new.slug is null or new.slug = '' then new.slug := privado.slug_livre(new.nome, new.id); end if;
  new.slug := lower(new.slug);
  return new;
end $$;

drop trigger if exists restaurante_slug on public.restaurantes;
create trigger restaurante_slug before insert on public.restaurantes
  for each row execute function privado.restaurante_slug();

grant update (slug) on public.restaurantes to authenticated;

-- Resolve o link curto: devolve o código da loja ou o token da mesa
create or replace function public.link_resolver(p_loja text, p_mesa text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  r record;
  m record;
  alvo text;
begin
  select id, codigo, slug into r from restaurantes where slug = lower(trim(p_loja));
  if not found then return null; end if;
  if p_mesa is null or p_mesa = '' then
    return jsonb_build_object('slug', r.slug, 'codigo', r.codigo);
  end if;
  alvo := regexp_replace(privado.slugificar(p_mesa), '-', '', 'g');
  select token into m from mesas
   where restaurante_id = r.id
     and regexp_replace(privado.slugificar(nome), '-', '', 'g') = alvo
   order by ordem, nome limit 1;
  if not found then return null; end if;
  return jsonb_build_object('slug', r.slug, 'token', m.token);
end $$;

revoke all on function public.link_resolver(text, text) from public;
grant execute on function public.link_resolver(text, text) to anon, authenticated;
