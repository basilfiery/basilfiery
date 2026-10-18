-- Cancelamento com motivo: do pedido inteiro ou só de alguns itens.
-- A mesa (tablet e celulares liberados) recebe o aviso "O X foi cancelado porque acabou".

alter table public.pedidos add column if not exists cancel_motivo text;

create table if not exists public.itens_cancelados (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  mesa_id uuid,
  produto_id uuid,
  nome text not null,
  qtd int not null,
  valor numeric(10,2) not null default 0,
  motivo text,
  pedido_inteiro boolean not null default false,
  por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
create index if not exists itens_cancelados_mesa on public.itens_cancelados (mesa_id, criado_em desc);
create index if not exists itens_cancelados_pedido on public.itens_cancelados (pedido_id);
alter table public.itens_cancelados enable row level security;
drop policy if exists itens_cancelados_ler on public.itens_cancelados;
create policy itens_cancelados_ler on public.itens_cancelados for select using (public.eh_membro(restaurante_id));
grant select on public.itens_cancelados to authenticated;

-- Cancela o pedido inteiro (p_itens nulo) ou só os itens escolhidos.
-- Se sobrar nenhum item, o pedido inteiro é cancelado.
create or replace function public.pedido_cancelar(p_pedido uuid, p_itens uuid[] default null, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.pedidos;
  v_motivo text := nullif(left(trim(coalesce(p_motivo, '')), 140), '');
  v_restantes int;
  v_valor numeric(10,2);
begin
  select * into v from public.pedidos where id = p_pedido for update;
  if not found or not public.eh_membro(v.restaurante_id) then raise exception 'Pedido não encontrado'; end if;
  if v.status = 'cancelado' then raise exception 'Este pedido já foi cancelado'; end if;

  if p_itens is not null then
    if cardinality(p_itens) = 0 then raise exception 'Escolha o item que vai cancelar'; end if;
    if exists (select 1 from unnest(p_itens) x where not exists (select 1 from public.pedido_itens i where i.id = x and i.pedido_id = v.id)) then
      raise exception 'Item não encontrado neste pedido';
    end if;
    select count(*) into v_restantes from public.pedido_itens i where i.pedido_id = v.id and not (i.id = any(p_itens));
  end if;

  -- Pedido inteiro
  if p_itens is null or v_restantes = 0 then
    insert into public.itens_cancelados (restaurante_id, pedido_id, mesa_id, produto_id, nome, qtd, valor, motivo, pedido_inteiro)
    select v.restaurante_id, v.id, v.mesa_id, i.produto_id, i.nome, i.qtd, i.preco_unit * i.qtd, v_motivo, true
    from public.pedido_itens i where i.pedido_id = v.id;
    update public.pedidos set cancel_motivo = v_motivo where id = v.id;
    perform public.pedido_mudar_status(v.id, 'cancelado');
    return jsonb_build_object('pedido_cancelado', true, 'total', v.total);
  end if;

  -- Só alguns itens
  if v.pago_em is not null then raise exception 'Esta conta já foi paga. Para devolver, cancele o pedido inteiro.'; end if;

  insert into public.itens_cancelados (restaurante_id, pedido_id, mesa_id, produto_id, nome, qtd, valor, motivo)
  select v.restaurante_id, v.id, v.mesa_id, i.produto_id, i.nome, i.qtd, i.preco_unit * i.qtd, v_motivo
  from public.pedido_itens i where i.id = any(p_itens);

  with q as (
    select i.produto_id, sum(i.qtd)::int as qtd
    from public.pedido_itens i join public.produtos p on p.id = i.produto_id
    where i.id = any(p_itens) and p.controla_estoque
    group by i.produto_id
  ), u as (
    update public.produtos p set estoque = p.estoque + q.qtd from q where p.id = q.produto_id returning p.id
  )
  insert into public.movimentos_estoque (restaurante_id, produto_id, delta, motivo, pedido_id)
  select v.restaurante_id, q.produto_id, q.qtd, 'Item cancelado do pedido #' || v.numero, v.id from q;

  select coalesce(sum(i.preco_unit * i.qtd), 0) into v_valor from public.pedido_itens i where i.id = any(p_itens);
  delete from public.pedido_itens where id = any(p_itens);
  update public.pedidos set total = greatest(0, total - v_valor) where id = v.id returning total into v_valor;
  return jsonb_build_object('pedido_cancelado', false, 'total', v_valor);
end $$;

-- Avisos de cancelamento para a mesa (desde a última conta fechada, até 3 horas)
create or replace function public.mesa_cancelamentos(p_token text, p_dispositivo text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_mesa public.mesas := privado.mesa_do_token(p_token);
begin
  begin
    perform privado.exigir_acesso(v_mesa, p_dispositivo);
  exception when others then
    return '[]'::jsonb;
  end;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome, 'qtd', c.qtd, 'motivo', c.motivo,
                                        'numero', p.numero, 'pedido_inteiro', c.pedido_inteiro, 'quando', c.criado_em) order by c.criado_em)
    from public.itens_cancelados c join public.pedidos p on p.id = c.pedido_id
    where c.mesa_id = v_mesa.id
      and c.criado_em > now() - interval '3 hours'
      and c.criado_em > coalesce((select max(x.pago_em) from public.pedidos x where x.mesa_id = v_mesa.id), '-infinity'::timestamptz)
  ), '[]'::jsonb);
end $$;

-- Delivery: o cliente vê o motivo e os itens que saíram do pedido
create or replace function public.loja_pedido_status(p_acompanhar text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'numero', p.numero, 'status', p.status, 'tipo', p.tipo, 'total', p.total, 'taxa', p.taxa_entrega,
    'criado_em', p.criado_em, 'atualizado_em', p.atualizado_em, 'pago', p.pago_em is not null,
    'forma', p.forma_pagamento, 'troco', p.troco_para, 'endereco', p.endereco, 'cliente', p.cliente_nome,
    'motivo', p.cancel_motivo,
    'itens', (select jsonb_agg(jsonb_build_object('nome', i.nome, 'qtd', i.qtd, 'preco', i.preco_unit, 'complementos', i.complementos) order by i.nome)
              from public.pedido_itens i where i.pedido_id = p.id),
    'cancelados', (select jsonb_agg(jsonb_build_object('nome', c.nome, 'qtd', c.qtd, 'motivo', c.motivo) order by c.criado_em)
                   from public.itens_cancelados c where c.pedido_id = p.id and not c.pedido_inteiro),
    'loja', jsonb_build_object('nome', r.nome, 'logo_url', r.logo_url, 'cor', r.cor, 'whatsapp', r.whatsapp,
                               'endereco', r.endereco, 'codigo', r.codigo, 'tempo', r.delivery_tempo)
  )
  from public.pedidos p join public.restaurantes r on r.id = p.restaurante_id
  where p.acompanhar = p_acompanhar
$$;

revoke execute on function public.pedido_cancelar(uuid, uuid[], text), public.mesa_cancelamentos(text, text) from public;
grant execute on function public.pedido_cancelar(uuid, uuid[], text) to authenticated;
grant execute on function public.mesa_cancelamentos(text, text) to anon, authenticated;
