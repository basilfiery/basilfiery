-- Domínio próprio (plano Premium/Rede) e endereço /assinante/<loja> (plano Start)

alter table public.restaurantes add column if not exists dominio text;
alter table public.restaurantes add column if not exists dominio_status text;
alter table public.restaurantes add column if not exists dominio_verificado_em timestamptz;
do $$ begin
  alter table public.restaurantes add constraint restaurantes_dominio_key unique (dominio);
exception when duplicate_object or duplicate_table then null; end $$;
do $$ begin
  alter table public.restaurantes add constraint restaurantes_dominio_formato check (
    dominio is null or (dominio ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$' and dominio not like 'www.%' and length(dominio) <= 120)
  );
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.restaurantes add constraint restaurantes_dominio_status_check check (dominio_status is null or dominio_status in ('pendente', 'ativo'));
exception when duplicate_object then null; end $$;
-- Só o servidor (função "dominios") altera o domínio
revoke update (dominio, dominio_status, dominio_verificado_em) on public.restaurantes from authenticated;

-- Planos novos: Start, Premium e Rede
update public.restaurantes set plano = 'start' where plano = 'essencial';
update public.restaurantes set plano = 'premium' where plano = 'profissional';
update public.assinaturas set plano = 'start' where plano = 'essencial';
update public.assinaturas set plano = 'premium' where plano = 'profissional';

-- "assinante" não pode virar endereço de loja
create or replace function public.slug_reservado(p text)
returns boolean language sql immutable set search_path = public as $$
  select p ~ '^mesa[0-9]*$' or p = any (array[
    'loja','login','entrar','cadastro','ativar','assinar','assinante','assinantes','assinatura','baixar','download','termos','privacidade','dono','g','garcom','garcons','lista','colaboradores',
    'plataforma','painel','admin','app','apps','api','assets','delivery','pedido','pedidos','suporte','ajuda',
    'contato','planos','precos','blog','www','site','basil','sw','manifest','versao','static','public','conta','perfil','dominios'
  ])
$$;

-- Resolve o link: por endereço (/assinante/<loja>, /cardapio) ou pelo domínio próprio da loja
drop function if exists public.link_resolver(text, text);
create or replace function public.link_resolver(p_loja text default null, p_mesa text default null, p_dominio text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  r record;
  tok text;
  mesa_txt text := nullif(p_mesa, '');
  alvo text;
begin
  if nullif(p_dominio, '') is not null then
    select id, codigo, slug, dominio into r from restaurantes
     where dominio = regexp_replace(lower(trim(p_dominio)), '^www\.', '') and dominio_status = 'ativo';
    if not found then return null; end if;
  else
    select id, codigo, slug, dominio into r from restaurantes where slug = lower(trim(coalesce(p_loja, '')));
    if not found then
      if mesa_txt is not null then return null; end if;
      -- Não é loja: talvez seja uma mesa da loja principal (/mesa1)
      select id, codigo, slug, dominio into r from restaurantes where slug = 'cardapio';
      if not found then return null; end if;
      mesa_txt := p_loja;
    end if;
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
revoke all on function public.link_resolver(text, text, text) from public;
grant execute on function public.link_resolver(text, text, text) to anon, authenticated;
