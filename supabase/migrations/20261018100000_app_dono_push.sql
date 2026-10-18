-- App do dono (/dono): o celular do dono recebe só as vendas, e o toque abre o app dele.
alter table public.push_inscricoes add column app text not null default 'garcom' check (app in ('garcom', 'dono'));

drop function public.push_inscrever(uuid, text, text, text);
create function public.push_inscrever(p_rest uuid, p_endpoint text, p_p256dh text, p_auth text, p_app text default 'garcom') returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.eh_membro(p_rest) then raise exception 'Sem permissão'; end if;
  if p_app not in ('garcom', 'dono') then raise exception 'App inválido'; end if;
  if p_app = 'dono' and not public.tem_papel(p_rest, '{dono}') then raise exception 'Só o dono recebe os avisos de venda'; end if;
  delete from public.push_inscricoes where endpoint = p_endpoint;
  insert into public.push_inscricoes (user_id, restaurante_id, endpoint, p256dh, auth, app)
  values ((select auth.uid()), p_rest, p_endpoint, p_p256dh, p_auth, p_app);
end $$;
revoke execute on function public.push_inscrever(uuid, text, text, text, text) from public, anon;
grant execute on function public.push_inscrever(uuid, text, text, text, text) to authenticated;

-- O aviso diz o tipo do evento (venda, pronto, chamado, acesso) para cada app filtrar o que interessa
create or replace function privado.notificar_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_segredo text;
  v_payload jsonb;
begin
  select valor into v_url from privado.config where chave = 'push_url';
  select valor into v_segredo from privado.config where chave = 'push_segredo';
  if v_url is null then return new; end if;

  if tg_table_name = 'pedidos' then
    if tg_op = 'INSERT' then
      v_payload := jsonb_build_object(
        'titulo', 'Novo pedido #' || new.numero || ' · ' || new.mesa_nome,
        'corpo', 'Total R$ ' || replace(to_char(new.total, 'FM999990.00'), '.', ','),
        'tag', 'pedido-' || new.id,
        'evento', 'venda', 'mesa', new.mesa_nome,
        'valor', 'R$ ' || replace(to_char(new.total, 'FM999990.00'), '.', ','));
    elsif new.status = 'pronto' and old.status is distinct from 'pronto' then
      v_payload := jsonb_build_object(
        'titulo', 'Pedido #' || new.numero || ' pronto · ' || new.mesa_nome,
        'corpo', 'Pode levar para a mesa.',
        'tag', 'pedido-' || new.id, 'evento', 'pronto');
    else
      return new;
    end if;
  elsif tg_table_name = 'chamados' then
    v_payload := jsonb_build_object(
      'titulo', case
        when new.tipo = 'conta' then new.mesa_nome || ' pediu a conta'
        when new.motivo is not null then new.mesa_nome || ': ' || new.motivo
        else new.mesa_nome || ' chamou o garçom' end,
      'corpo', coalesce(new.detalhe, 'Toque para ver e marcar como atendido.'),
      'tag', 'chamado-' || new.id, 'evento', 'chamado');
  elsif tg_table_name = 'mesa_acessos' then
    v_payload := jsonb_build_object(
      'titulo', new.mesa_nome || ' quer fazer pedidos',
      'corpo', 'Toque para liberar a mesa' || coalesce(' (' || new.aparelho || ')', '') || '.',
      'tag', 'acesso-' || new.id, 'evento', 'acesso');
  else
    return new;
  end if;

  v_payload := v_payload || jsonb_build_object('restaurante_id', new.restaurante_id, 'url', '/garcom');
  perform net.http_post(
    url := v_url,
    body := v_payload,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-segredo', v_segredo)
  );
  return new;
end $$;
