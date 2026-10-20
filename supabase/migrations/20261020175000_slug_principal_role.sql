-- Com security definer, current_user vira o dono da função: confere o papel pelo JWT da requisição
create or replace function privado.slug_principal_protegido()
returns trigger language plpgsql security definer set search_path = public, privado as $$
begin
  if new.slug = 'cardapio' and (tg_op = 'INSERT' or old.slug is distinct from 'cardapio')
     and coalesce(auth.role(), '') in ('authenticated', 'anon') then
    raise exception 'Esse endereço é reservado pelo sistema.' using errcode = '23514';
  end if;
  return new;
end $$;
