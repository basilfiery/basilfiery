-- Notificações: pedido criado → "Novo pedido" (uma só); conta paga → "Nova venda".
--   * pedido (mesa, delivery, retirada): evento 'pedido'
--   * venda: quando entra um pagamento (conta da mesa fechada, venda no balcão) ou o delivery é entregue
--   * venda no balcão já paga não gera "Novo pedido" (só a venda)

create or replace function privado.notificar_push()
returns trigger
language plpgsql security definer set search_path = '' as $function$
declare
  v_url text;
  v_segredo text;
  v_payload jsonb;
  v_valor text;
begin
  select valor into v_url from privado.config where chave = 'push_url';
  select valor into v_segredo from privado.config where chave = 'push_segredo';
  if v_url is null then return new; end if;

  if tg_table_name = 'pedidos' then
    v_valor := 'R$ ' || replace(to_char(new.total, 'FM999990.00'), '.', ',');
    if tg_op = 'INSERT' then
      -- Balcão já pago: o aviso é a venda (pelo pagamento)
      if new.tipo = 'balcao' and new.status = 'entregue' then return new; end if;
      v_payload := jsonb_build_object(
        'titulo', 'Novo pedido #' || new.numero || ' · ' || new.mesa_nome,
        'corpo', 'Total ' || v_valor,
        'tag', 'pedido-' || new.id,
        'evento', 'pedido', 'mesa', new.mesa_nome, 'valor', v_valor);
    elsif new.status = 'pronto' and old.status is distinct from 'pronto' then
      v_payload := jsonb_build_object(
        'titulo', 'Pedido #' || new.numero || ' pronto · ' || new.mesa_nome,
        'corpo', case when new.tipo = 'mesa' then 'Pode levar para a mesa.' else 'Pode entregar.' end,
        'tag', 'pedido-' || new.id, 'evento', 'pronto');
    elsif new.status = 'entregue' and old.status is distinct from 'entregue' and new.tipo in ('delivery', 'retirada') then
      v_payload := jsonb_build_object(
        'titulo', 'Nova venda! ' || v_valor,
        'corpo', new.mesa_nome || ' #' || new.numero || ' entregue',
        'tag', 'venda-' || new.id, 'evento', 'venda', 'mesa', new.mesa_nome, 'valor', v_valor);
    else
      return new;
    end if;
  elsif tg_table_name = 'pagamentos' then
    v_valor := 'R$ ' || replace(to_char(new.valor, 'FM999990.00'), '.', ',');
    v_payload := jsonb_build_object(
      'titulo', 'Nova venda! ' || v_valor,
      'corpo', new.mesa_nome || ' · conta paga',
      'tag', 'venda-' || new.id, 'evento', 'venda', 'mesa', new.mesa_nome, 'valor', v_valor);
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
end $function$;

drop trigger if exists pagamentos_push on public.pagamentos;
create trigger pagamentos_push after insert on public.pagamentos for each row execute function privado.notificar_push();
