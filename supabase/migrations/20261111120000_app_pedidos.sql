-- App de pedidos (atendente): recebe os pedidos do cardápio digital, anota e manda para a cozinha.
-- O cargo 'atendente' foi criado antes (alter type ... add value não roda junto com o uso dele):
--   alter type public.papel_membro add value if not exists 'atendente';

-- Atendente também escolhe o entregador, marca a saída e esgota itens do cardápio
CREATE OR REPLACE FUNCTION public.categoria_esgotar(p_categoria uuid, p_esgotado boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_rest uuid;
begin
  select restaurante_id into v_rest from public.categorias where id = p_categoria;
  if v_rest is null or not public.tem_papel(v_rest, '{dono,gerente,caixa,atendente}') then
    raise exception 'Sem permissão para esgotar';
  end if;
  update public.categorias set esgotado = p_esgotado where id = p_categoria;
end $function$;

CREATE OR REPLACE FUNCTION public.entrega_atribuir(p_pedido uuid, p_entregador uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v public.pedidos; v_nome text;
begin
  v := privado.pedido_entrega(p_pedido);
  if not public.tem_papel(v.restaurante_id, '{dono,gerente,caixa,atendente}') then raise exception 'Sem permissão'; end if;
  if p_entregador is null then
    update public.pedidos set entregador_id = null, entregador_nome = null, saiu_em = null, atualizado_em = now() where id = v.id;
    return;
  end if;
  select nome into v_nome from public.membros where restaurante_id = v.restaurante_id and user_id = p_entregador and papel = 'entregador';
  if v_nome is null then raise exception 'Entregador não encontrado'; end if;
  update public.pedidos set entregador_id = p_entregador, entregador_nome = v_nome, atualizado_em = now() where id = v.id;
end $function$;

CREATE OR REPLACE FUNCTION public.entrega_saiu(p_pedido uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v public.pedidos;
begin
  v := privado.pedido_entrega(p_pedido);
  if v.entregador_id is null and public.eh_entregador(v.restaurante_id) then perform public.entrega_pegar(p_pedido); v := privado.pedido_entrega(p_pedido); end if;
  if v.entregador_id is distinct from auth.uid() and not public.tem_papel(v.restaurante_id, '{dono,gerente,caixa,atendente}') then
    raise exception 'Esta entrega não é sua';
  end if;
  if v.entregador_id is null then raise exception 'Escolha o entregador antes'; end if;
  update public.pedidos set saiu_em = coalesce(saiu_em, now()), atualizado_em = now(),
    status = case when status in ('novo', 'preparando') then 'pronto'::public.status_pedido else status end
  where id = v.id;
end $function$;

CREATE OR REPLACE FUNCTION public.produto_esgotar(p_produto uuid, p_esgotado boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_rest uuid;
begin
  select restaurante_id into v_rest from public.produtos where id = p_produto;
  if v_rest is null or not public.tem_papel(v_rest, '{dono,gerente,caixa,atendente}') then
    raise exception 'Sem permissão para esgotar itens';
  end if;
  update public.produtos set esgotado = p_esgotado where id = p_produto;
end $function$;

-- Imprimir um pedido na impressora do caixa a partir do celular/tablet
alter table public.fila_impressao drop constraint if exists fila_impressao_tipo_check;
alter table public.fila_impressao add constraint fila_impressao_tipo_check check (tipo in ('conta', 'pedido'));
alter table public.fila_impressao add column if not exists pedido_id uuid references public.pedidos(id) on delete cascade;
create index if not exists fila_impressao_pedido_idx on public.fila_impressao (pedido_id) where pedido_id is not null;

create or replace function public.impressao_solicitar_pedido(p_pedido uuid)
returns uuid language plpgsql security definer set search_path to '' as $$
declare
  v_rest uuid;
  v_id uuid;
begin
  select restaurante_id into v_rest from public.pedidos where id = p_pedido;
  if v_rest is null or not public.eh_membro(v_rest) or public.eh_entregador(v_rest) then raise exception 'Pedido não encontrado'; end if;
  insert into public.fila_impressao (restaurante_id, tipo, pedido_id, solicitado_por, solicitado_por_nome)
  values (v_rest, 'pedido', p_pedido, (select auth.uid()), public.nome_membro(v_rest))
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.impressao_solicitar_pedido(uuid) from public, anon;
grant execute on function public.impressao_solicitar_pedido(uuid) to authenticated;

-- Abrir/fechar o cardápio digital e mudar o tempo de entrega na hora do movimento
create or replace function public.loja_recebimento(p_rest uuid, p_aberto boolean default null, p_tempo text default null)
returns void language plpgsql security definer set search_path to '' as $$
begin
  if not public.tem_papel(p_rest, '{dono,gerente,caixa,atendente}') then raise exception 'Sem permissão'; end if;
  if p_tempo is not null and p_tempo !~ '^\d{1,3} a \d{1,3} min$' then raise exception 'Tempo inválido'; end if;
  update public.restaurantes
     set delivery_ativo = coalesce(p_aberto, delivery_ativo),
         delivery_tempo = coalesce(p_tempo, delivery_tempo)
   where id = p_rest;
end $$;
revoke execute on function public.loja_recebimento(uuid, boolean, text) from public, anon;
grant execute on function public.loja_recebimento(uuid, boolean, text) to authenticated;

-- Avisos no celular do app de pedidos
create or replace function public.push_inscrever(p_rest uuid, p_endpoint text, p_p256dh text, p_auth text, p_app text default 'garcom')
returns void language plpgsql security definer set search_path to '' as $$
begin
  if not public.eh_membro(p_rest) then raise exception 'Sem permissão'; end if;
  if p_app not in ('garcom', 'dono', 'entregador', 'atendente') then raise exception 'App inválido'; end if;
  if p_app = 'dono' and not public.tem_papel(p_rest, '{dono}') then raise exception 'Só o dono recebe os avisos de venda'; end if;
  delete from public.push_inscricoes where endpoint = p_endpoint;
  insert into public.push_inscricoes (user_id, restaurante_id, endpoint, p256dh, auth, app)
  values ((select auth.uid()), p_rest, p_endpoint, p_p256dh, p_auth, p_app);
end $$;
alter table public.push_inscricoes drop constraint if exists push_inscricoes_app_check;
alter table public.push_inscricoes add constraint push_inscricoes_app_check check (app in ('garcom', 'dono', 'entregador', 'atendente'));
