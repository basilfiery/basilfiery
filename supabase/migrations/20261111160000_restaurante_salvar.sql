-- Salvar dados da loja sem depender de liberar coluna por coluna (campo novo nunca mais dá "sem permissão").
-- Só ficam de fora os campos da plataforma (plano, código, domínio, contador de pedidos…).
create or replace function public.restaurante_salvar(p_rest uuid, p_campos jsonb)
returns void language plpgsql security definer set search_path to '' as $$
declare
  v_set text;
  v_ruim text;
  v_protegidos text[] := array['id', 'plano', 'ativo', 'ultimo_pedido', 'criado_em', 'codigo', 'plano_valor', 'plano_vence_em',
                               'plano_forma', 'dominio', 'dominio_status', 'dominio_verificado_em'];
begin
  if not public.tem_papel(p_rest, '{dono,gerente}') then raise exception 'Só o dono ou o gerente pode alterar os dados da loja'; end if;
  if jsonb_typeof(p_campos) is distinct from 'object' or p_campos = '{}'::jsonb then return; end if;
  select k into v_ruim from jsonb_object_keys(p_campos) k
  where k = any (v_protegidos)
     or not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'restaurantes' and c.column_name = k)
  limit 1;
  if v_ruim is not null then raise exception 'O campo "%" não pode ser alterado por aqui', v_ruim; end if;
  select string_agg(format('%I = x.%I', k, k), ', ') into v_set from jsonb_object_keys(p_campos) k;
  execute format('update public.restaurantes r set %s from jsonb_populate_record(null::public.restaurantes, $1) x where r.id = $2', v_set)
  using p_campos, p_rest;
end $$;
revoke execute on function public.restaurante_salvar(uuid, jsonb) from public, anon;
grant execute on function public.restaurante_salvar(uuid, jsonb) to authenticated;
