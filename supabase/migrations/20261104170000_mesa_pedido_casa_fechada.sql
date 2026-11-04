-- Mesa (QR code / tablet): cliente pode abrir o cardápio, ser liberado e chamar o garçom a qualquer hora.
-- Só não consegue enviar pedido quando o caixa está fechado E a loja está fechada (fora do horário ou desligada).
create or replace function privado.mesa_recebe_pedidos(p_rest uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.caixas where restaurante_id = p_rest and fechado_em is null)
    or coalesce((select privado.loja_aberta(r) from public.restaurantes r where r.id = p_rest), false)
$$;
revoke execute on function privado.mesa_recebe_pedidos(uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.mesa_cardapio(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_mesa public.mesas;
  v_rest public.restaurantes;
begin
  select * into v_mesa from public.mesas where token = p_token and ativo;
  if not found then raise exception 'Mesa não encontrada'; end if;
  select * into v_rest from public.restaurantes where id = v_mesa.restaurante_id;
  if not v_rest.ativo then raise exception 'Restaurante indisponível no momento'; end if;
  return jsonb_build_object(
    'restaurante', jsonb_build_object('id', v_rest.id, 'nome', v_rest.nome, 'slogan', v_rest.slogan, 'logo_url', v_rest.logo_url, 'cor', v_rest.cor,
      'capa_url', v_rest.loja_capa_url, 'capa_video_url', v_rest.capa_video_url),
    'mesa', jsonb_build_object('id', v_mesa.id, 'nome', v_mesa.nome),
    'recebendo', privado.mesa_recebe_pedidos(v_rest.id)
  ) || privado.cardapio_json(v_rest.id);
end $function$;

CREATE OR REPLACE FUNCTION public.mesa_pedido_enviar(p_token text, p_dispositivo text, p_itens jsonb, p_obs text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_mesa public.mesas := privado.mesa_do_token(p_token);
begin
  perform privado.exigir_acesso(v_mesa, p_dispositivo);
  if not privado.mesa_recebe_pedidos(v_mesa.restaurante_id) then
    raise exception 'A casa está fechada agora. Os pedidos voltam quando abrir.';
  end if;
  return public.mesa_criar_pedido(p_token, p_itens, p_obs);
end $function$;
