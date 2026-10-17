-- App do garçom em link próprio: /g/<codigo>. O código é curto e não revela o id do restaurante.
create or replace function privado.novo_codigo() returns text
language plpgsql volatile set search_path = '' as $$
declare
  v text;
begin
  loop
    -- 6 caracteres fáceis de ler (sem 0/o, 1/l/i)
    select string_agg(substr('abcdefghjkmnpqrstuvwxyz23456789', 1 + floor(random() * 31)::int, 1), '')
      into v from generate_series(1, 6);
    exit when not exists (select 1 from public.restaurantes where codigo = v);
  end loop;
  return v;
end $$;

alter table public.restaurantes add column codigo text;
update public.restaurantes set codigo = privado.novo_codigo() where codigo is null;
alter table public.restaurantes alter column codigo set not null;
alter table public.restaurantes alter column codigo set default privado.novo_codigo();
alter table public.restaurantes add constraint restaurantes_codigo_unico unique (codigo);

-- Dados públicos mínimos para a tela de entrada do app (nome, logo e cor)
create function public.app_garcom_info(p_codigo text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'nome', r.nome, 'logo_url', r.logo_url, 'cor', r.cor)
  from public.restaurantes r where r.codigo = lower(trim(p_codigo)) and r.ativo
$$;
grant execute on function public.app_garcom_info(text) to anon, authenticated;
