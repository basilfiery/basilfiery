-- Cardápio da mesa e digital atualizam na hora: qualquer mudança no cardápio avisa os aparelhos
-- (canal público "cardapio:<restaurante>", só um sinal, sem dados).

create or replace function privado.avisar_cardapio() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  j jsonb;
  v_rest uuid;
begin
  if tg_op = 'DELETE' then j := to_jsonb(old); else j := to_jsonb(new); end if;
  if tg_table_name = 'restaurantes' then
    -- Número do último pedido muda a cada pedido: não é mudança de cardápio
    if tg_op = 'UPDATE' and (to_jsonb(new) - 'ultimo_pedido') = (to_jsonb(old) - 'ultimo_pedido') then return null; end if;
    v_rest := (j ->> 'id')::uuid;
  else
    v_rest := (j ->> 'restaurante_id')::uuid;
  end if;
  if v_rest is not null then
    begin
      perform realtime.send('{}'::jsonb, 'mudou', 'cardapio:' || v_rest, false);
    exception when others then null; -- o aviso nunca impede a gravação
    end;
  end if;
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['restaurantes', 'categorias', 'produtos', 'adicionais', 'adicional_grupos', 'produto_adicionais', 'grupos', 'mesas'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists cardapio_ao_vivo on public.%I', t);
      execute format('create trigger cardapio_ao_vivo after insert or update or delete on public.%I for each row execute function privado.avisar_cardapio()', t);
    end if;
  end loop;
end $$;
