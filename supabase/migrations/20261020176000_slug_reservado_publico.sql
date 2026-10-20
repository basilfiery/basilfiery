-- A checagem do endereço (CHECK) roda com o papel de quem grava (painel/servidor):
-- a função de nomes reservados fica em public (pura, sem acesso a dados).
create or replace function public.slug_reservado(p text)
returns boolean language sql immutable set search_path = public as $$
  select p ~ '^mesa[0-9]*$' or p = any (array[
    'loja','login','entrar','cadastro','ativar','assinar','assinatura','baixar','download','termos','privacidade','dono','g','garcom','garcons','lista','colaboradores',
    'plataforma','painel','admin','app','apps','api','assets','delivery','pedido','pedidos','suporte','ajuda',
    'contato','planos','precos','blog','www','site','basil','sw','manifest','versao','static','public','conta','perfil'
  ])
$$;
grant execute on function public.slug_reservado(text) to anon, authenticated, service_role;

alter table public.restaurantes drop constraint restaurantes_slug_formato;
alter table public.restaurantes add constraint restaurantes_slug_formato check (
  slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 40 and not public.slug_reservado(slug)
);

create or replace function privado.slug_livre(p_nome text, p_id uuid)
returns text language plpgsql security definer set search_path = public, privado as $$
declare
  base text := left(privado.slugificar(p_nome), 36);
  tentativa text;
  n int := 1;
begin
  if length(base) < 3 or public.slug_reservado(base) then base := 'loja-' || coalesce(nullif(base, ''), 'nova'); end if;
  tentativa := base;
  while exists (select 1 from public.restaurantes where slug = tentativa and id <> p_id) loop
    n := n + 1;
    tentativa := base || '-' || n;
  end loop;
  return tentativa;
end $$;

drop function if exists privado.slug_reservado(text);
