-- Meta do mês do app do dono fica no banco (antes ficava só no celular e sumia ao reinstalar o app)
alter table public.restaurantes add column if not exists meta_mensal numeric(12, 2) check (meta_mensal is null or meta_mensal > 0);
grant update (meta_mensal) on public.restaurantes to authenticated;
