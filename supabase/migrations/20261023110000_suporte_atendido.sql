-- Quando uma pessoa do time responde, a loja deixa de aparecer como "quer falar com uma pessoa"
do $$
declare d text;
begin
  d := pg_get_functiondef('public.suporte_enviar(uuid, text, boolean, text, text, int)'::regprocedure);
  if position('pedido_humano_em = null' in d) = 0 then
    d := replace(d, 'on conflict (restaurante_id) do update set modo = ''humano'', atendente_id = excluded.atendente_id,',
                    'on conflict (restaurante_id) do update set modo = ''humano'', pedido_humano_em = null, atendente_id = excluded.atendente_id,');
    if position('pedido_humano_em = null' in d) = 0 then raise exception 'suporte_enviar: trecho não encontrado'; end if;
    execute d;
  end if;
end $$;
