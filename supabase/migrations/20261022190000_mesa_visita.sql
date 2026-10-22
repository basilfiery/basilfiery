-- "Visita" da mesa: muda a cada nova liberação do aparelho e a cada conta fechada.
-- O cardápio usa para o order bump: quem recusou não vê a oferta de novo na mesma visita,
-- mas o próximo cliente da mesa (ou o mesmo cliente outro dia) vê.
create or replace function public.mesa_visita(p_token text, p_dispositivo text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_mesa public.mesas := privado.mesa_do_token(p_token);
  v_acesso uuid;
  v_pag uuid;
begin
  select id into v_acesso from public.mesa_acessos
  where mesa_id = v_mesa.id and dispositivo = p_dispositivo and status = 'liberado'
  order by criado_em desc limit 1;
  select id into v_pag from public.pagamentos where mesa_id = v_mesa.id order by criado_em desc limit 1;
  return coalesce(v_acesso::text, 'equipe') || ':' || coalesce(v_pag::text, 'inicio');
end $$;
revoke all on function public.mesa_visita(text, text) from public;
grant execute on function public.mesa_visita(text, text) to anon, authenticated;
