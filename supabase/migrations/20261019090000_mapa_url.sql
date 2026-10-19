-- Link do Google Maps da loja ("Ver no mapa" no cardápio digital)
alter table public.restaurantes add column if not exists mapa_url text
  check (mapa_url is null or (char_length(mapa_url) <= 300 and mapa_url ~* '^https://'));

CREATE OR REPLACE FUNCTION public.loja_cardapio(p_codigo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.restaurantes;
begin
  select * into v from public.restaurantes where codigo = lower(trim(p_codigo));
  if not found or not v.ativo then raise exception 'Loja não encontrada'; end if;
  return jsonb_build_object(
    'restaurante', jsonb_build_object(
      'id', v.id, 'nome', v.nome, 'slogan', v.slogan, 'logo_url', v.logo_url, 'cor', v.cor,
      'aberto', privado.loja_aberta(v), 'ligado', v.delivery_ativo,
      'taxa', v.delivery_taxa, 'minimo', v.delivery_minimo, 'tempo', v.delivery_tempo,
      'entrega', v.entrega_ativa, 'retirada', v.retirada_ativa, 'whatsapp', v.whatsapp, 'endereco', v.endereco,
      'segmento', v.segmento, 'instagram', v.instagram, 'mapa_url', v.mapa_url, 'capa_url', v.loja_capa_url, 'capa_video_url', v.capa_video_url,
      'descricao', v.loja_descricao, 'rodape', v.loja_rodape, 'obs', v.loja_obs, 'formas', to_jsonb(v.formas_pagamento),
      'horarios', case when v.horarios_ativos then v.horarios end,
      'ads', jsonb_strip_nulls(jsonb_build_object('pixel', v.ads_pixel, 'ga4', v.ads_ga4, 'gads', v.ads_gads)),
      'entrega_modo', v.entrega_modo, 'lat', v.lat, 'lng', v.lng,
      'cidade', nullif(trim(concat_ws('/', v.endereco_info ->> 'cidade', v.endereco_info ->> 'uf')), ''),
      'raios', case when v.entrega_modo = 'raio' then v.entrega_raios end,
      'bairros', case when v.entrega_modo = 'bairro' then (select jsonb_agg(jsonb_build_object('nome', b ->> 'nome', 'taxa', (b ->> 'taxa')::numeric) order by b ->> 'nome') from jsonb_array_elements(v.entrega_bairros) b) end,
      'fidelidade', case when coalesce((v.fidelidade ->> 'ativo')::boolean, false) then jsonb_build_object(
        'meta', coalesce(nullif(v.fidelidade ->> 'meta', '')::int, 10),
        'premio', v.fidelidade ->> 'premio',
        'minimo', coalesce(nullif(v.fidelidade ->> 'minimo', '')::numeric, 0)) end
    )
  ) || privado.cardapio_json(v.id);
end $function$;

update public.restaurantes set mapa_url = 'https://maps.app.goo.gl/oswgWkrTXKdkr6hEA'
  where id = '14905cd4-3c3a-4628-9d08-036cbb01d70c';
