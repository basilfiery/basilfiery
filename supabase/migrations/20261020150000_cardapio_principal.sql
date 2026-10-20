-- Loja principal do domínio: basilfiery.com.br/cardapio e basilfiery.com.br/mesa1
-- (as outras lojas seguem em /<slug> e /<slug>/mesa1)

create or replace function privado.slug_reservado(p text)
returns boolean language sql immutable as $$
  select p ~ '^mesa[0-9]*$' or p = any (array[
    'loja','login','entrar','cadastro','termos','privacidade','dono','g','garcom','garcons','lista','colaboradores',
    'plataforma','painel','admin','app','apps','api','assets','delivery','pedido','pedidos','suporte','ajuda',
    'contato','planos','precos','blog','www','site','basil','sw','manifest','versao','static','public','conta','perfil'
  ])
$$;

-- "cardapio" só pode ser dado pela plataforma (não pelo painel da loja)
create or replace function privado.slug_principal_protegido()
returns trigger language plpgsql as $$
begin
  if new.slug = 'cardapio' and (tg_op = 'INSERT' or old.slug is distinct from 'cardapio')
     and current_user in ('authenticated', 'anon') then
    raise exception 'Esse endereço é reservado pelo sistema.' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists slug_principal_protegido on public.restaurantes;
create trigger slug_principal_protegido before insert or update of slug on public.restaurantes
  for each row execute function privado.slug_principal_protegido();

update public.restaurantes set slug = 'cardapio' where slug = 'basilfiery';

-- /<loja>, /<loja>/<mesa> ou, na loja principal, só /<mesa>
create or replace function public.link_resolver(p_loja text, p_mesa text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  r record;
  tok text;
  mesa_txt text := nullif(p_mesa, '');
  alvo text;
begin
  select id, codigo, slug into r from restaurantes where slug = lower(trim(p_loja));
  if not found then
    if mesa_txt is not null then return null; end if;
    -- Não é loja: talvez seja uma mesa da loja principal (/mesa1)
    select id, codigo, slug into r from restaurantes where slug = 'cardapio';
    if not found then return null; end if;
    mesa_txt := p_loja;
  end if;
  if mesa_txt is null then
    return jsonb_build_object('slug', r.slug, 'codigo', r.codigo);
  end if;
  alvo := regexp_replace(privado.slugificar(mesa_txt), '-', '', 'g');
  select token into tok from mesas
   where restaurante_id = r.id
     and regexp_replace(privado.slugificar(nome), '-', '', 'g') = alvo
   order by ordem, nome limit 1;
  if tok is null then return null; end if;
  return jsonb_build_object('slug', r.slug, 'token', tok, 'mesa', alvo);
end $$;
