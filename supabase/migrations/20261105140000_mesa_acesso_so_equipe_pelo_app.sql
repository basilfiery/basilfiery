-- QR Code da mesa sempre abre como CLIENTE (pede acesso), mesmo num celular logado como equipe
-- (o app do garçom divide a sessão com o Chrome). O modo equipe só vale quando a tela foi aberta
-- pelo "Lançar pedido" do app do garçom ou do painel (p_equipe = true).
-- Sem p_equipe (versões antigas da tela) continua como antes.

drop function if exists public.mesa_acesso_status(text, text);
create function public.mesa_acesso_status(p_token text, p_dispositivo text, p_equipe boolean default true)
 returns text language plpgsql stable security definer set search_path = '' as $function$
declare
  v_mesa public.mesas := privado.mesa_do_token(p_token);
  v_status text;
  v_destino text;
begin
  if p_equipe and privado.eh_equipe(v_mesa.restaurante_id) then return 'equipe'; end if;
  select status into v_status from public.mesa_acessos
  where mesa_id = v_mesa.id and dispositivo = p_dispositivo
  order by (status = 'liberado') desc, criado_em desc limit 1;
  if v_status in ('liberado', 'pendente', 'recusado') then return v_status; end if;

  select m.token into v_destino
  from public.mesa_acessos a join public.mesas m on m.id = a.mesa_id
  where a.dispositivo = p_dispositivo and a.status = 'liberado' and a.movido_de = v_mesa.id and m.ativo
  order by a.criado_em desc limit 1;
  if v_destino is not null then return 'movido:' || v_destino; end if;

  if exists (select 1 from public.mesa_acessos where mesa_id = v_mesa.id and status = 'liberado')
     or exists (select 1 from public.pedidos where mesa_id = v_mesa.id and pago_em is null and status <> 'cancelado') then
    return 'em_uso';
  end if;
  return 'nenhum';
end $function$;

drop function if exists public.mesa_acesso_pedir(text, text, text, text, text);
create function public.mesa_acesso_pedir(p_token text, p_dispositivo text, p_aparelho text default null, p_nome text default null, p_telefone text default null, p_equipe boolean default true)
 returns text language plpgsql security definer set search_path = '' as $function$
declare
  v_mesa public.mesas := privado.mesa_do_token(p_token);
  v_ultimo public.mesa_acessos;
  v_nome text := nullif(left(regexp_replace(trim(coalesce(p_nome, '')), '\s+', ' ', 'g'), 60), '');
  v_tel text := nullif(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g'), '');
begin
  if p_equipe and privado.eh_equipe(v_mesa.restaurante_id) then return 'equipe'; end if;
  if char_length(coalesce(p_dispositivo, '')) not between 16 and 64 then raise exception 'Aparelho inválido'; end if;
  if v_tel is not null and char_length(v_tel) not between 10 and 13 then raise exception 'WhatsApp com DDD, ou deixe em branco'; end if;

  select * into v_ultimo from public.mesa_acessos
  where mesa_id = v_mesa.id and dispositivo = p_dispositivo
  order by (status = 'liberado') desc, criado_em desc limit 1;
  if v_ultimo.status in ('liberado', 'pendente') then return v_ultimo.status; end if;
  if v_ultimo.status = 'recusado' and v_ultimo.respondido_em > now() - interval '1 minute' then
    raise exception 'Aguarde um minutinho para pedir de novo';
  end if;
  if (select count(*) from public.mesa_acessos where mesa_id = v_mesa.id and status = 'pendente') >= 6 then
    raise exception 'Muitos pedidos de acesso nesta mesa. Chame um atendente.';
  end if;

  insert into public.mesa_acessos (restaurante_id, mesa_id, mesa_nome, dispositivo, aparelho, cliente_nome, cliente_telefone)
  values (v_mesa.restaurante_id, v_mesa.id, v_mesa.nome, p_dispositivo, nullif(left(trim(p_aparelho), 40), ''), v_nome, v_tel);
  return 'pendente';
end $function$;

revoke execute on function public.mesa_acesso_status(text, text, boolean), public.mesa_acesso_pedir(text, text, text, text, text, boolean) from public;
grant execute on function public.mesa_acesso_status(text, text, boolean), public.mesa_acesso_pedir(text, text, text, text, text, boolean) to anon, authenticated;
