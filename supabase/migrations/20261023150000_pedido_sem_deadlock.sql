-- Casa cheia: dois pedidos ao mesmo tempo com os mesmos itens em ordem diferente travavam um ao outro
-- ("deadlock detected" — o pedido se perdia). Agora os itens são travados sempre na mesma ordem (por id),
-- e com NO KEY UPDATE, que não bloqueia quem só está gravando o pedido.
do $$
declare d text;
begin
  d := pg_get_functiondef('privado.precificar(uuid, jsonb)'::regprocedure);
  if position('ordem fixa' in d) = 0 then
    d := replace(d,
      $a$  for v_item in select * from jsonb_array_elements(p_itens) loop$a$,
      $a$  -- Trava os produtos em ordem fixa (por id) antes de tudo: evita deadlock com pedidos simultâneos
  perform 1 from public.produtos
  where restaurante_id = p_rest
    and id in (select (e ->> 'produto_id')::uuid from jsonb_array_elements(p_itens) e where e ? 'produto_id')
  order by id
  for no key update;

  for v_item in select * from jsonb_array_elements(p_itens) loop$a$);
    d := replace(d, $a$    where id = (v_item ->> 'produto_id')::uuid and restaurante_id = p_rest and ativo
    for update;$a$, $a$    where id = (v_item ->> 'produto_id')::uuid and restaurante_id = p_rest and ativo
    for no key update;$a$);
    if position('ordem fixa' in d) = 0 or position('for no key update;' in d) = 0 then
      raise exception 'precificar: trechos não encontrados';
    end if;
    execute d;
  end if;
end $$;
