-- Ficha do cliente: histórico de pedidos, o que ele mais pede e os endereços usados.
-- A chave é a mesma da lista de clientes: telefone (só números), 'u:<id da conta>' ou 'm:<nome>:<aparelho>' (só mesa).
create or replace function public.cliente_ficha(p_rest uuid, p_chave text)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_tel text;
  v_uid uuid;
  v_ids uuid[];
begin
  if not public.tem_papel(p_rest, '{dono,gerente,caixa}') then raise exception 'Sem permissão'; end if;
  if p_chave ~ '^\d+$' then
    v_tel := p_chave;
  elsif p_chave like 'u:%' then
    v_uid := nullif(substr(p_chave, 3), '')::uuid;
  end if;

  -- Pedidos do cliente: pelo WhatsApp, pela conta do cardápio, ou pela conta cujo perfil tem esse WhatsApp
  select coalesce(array_agg(p.id order by p.criado_em desc), '{}') into v_ids
  from public.pedidos p
  left join public.clientes_perfis cp on cp.user_id = p.cliente_user_id
  where p.restaurante_id = p_rest and (
    (v_tel is not null and (p.cliente_telefone = v_tel or regexp_replace(coalesce(cp.telefone, ''), '\D', '', 'g') = v_tel))
    or (v_uid is not null and p.cliente_user_id = v_uid));

  return jsonb_build_object(
    'pedidos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'numero', p.numero, 'criado_em', p.criado_em, 'tipo', p.tipo, 'status', p.status, 'total', p.total,
        'mesa_nome', p.mesa_nome, 'forma', p.forma_pagamento, 'bairro', p.endereco ->> 'bairro', 'frete_gratis', p.frete_gratis,
        'itens', (select jsonb_agg(jsonb_build_object('nome', i.nome, 'qtd', i.qtd, 'complementos', i.complementos) order by i.nome)
                  from public.pedido_itens i where i.pedido_id = p.id)
      ) order by p.criado_em desc)
      from public.pedidos p where p.id = any (v_ids)
    ), '[]'::jsonb),
    -- O que ele mais pede (pedidos não cancelados)
    'produtos', coalesce((
      select jsonb_agg(x order by (x ->> 'qtd')::int desc, x ->> 'nome')
      from (
        select jsonb_build_object('nome', i.nome, 'qtd', sum(i.qtd), 'vezes', count(distinct i.pedido_id), 'total', sum(i.qtd * i.preco_unit),
          -- Sabores/adicionais que ele mais escolhe nesse produto
          'preferido', (select i2.complementos from public.pedido_itens i2 join public.pedidos p2 on p2.id = i2.pedido_id
                        where p2.id = any (v_ids) and p2.status <> 'cancelado' and i2.nome = i.nome and nullif(trim(i2.complementos), '') is not null
                        group by i2.complementos order by sum(i2.qtd) desc, max(p2.criado_em) desc limit 1)) x
        from public.pedido_itens i join public.pedidos p on p.id = i.pedido_id
        where p.id = any (v_ids) and p.status <> 'cancelado'
        group by i.nome
        order by sum(i.qtd) desc
        limit 12
      ) t
    ), '[]'::jsonb),
    -- Endereços de entrega já usados (o mais recente primeiro)
    'enderecos', coalesce((
      select jsonb_agg(e order by em desc) from (
        select distinct on (lower(p.endereco ->> 'rua'), p.endereco ->> 'numero')
          p.endereco as e, p.criado_em as em
        from public.pedidos p
        where p.id = any (v_ids) and p.endereco is not null
        order by lower(p.endereco ->> 'rua'), p.endereco ->> 'numero', p.criado_em desc
      ) t
    ), '[]'::jsonb),
    -- Visitas na mesa (pediu acesso pelo QR code)
    'visitas', coalesce((
      select jsonb_agg(jsonb_build_object('mesa', a.mesa_nome, 'em', a.criado_em) order by a.criado_em desc)
      from (select * from public.mesa_acessos a
            where a.restaurante_id = p_rest and a.status in ('liberado', 'encerrado')
              and ((v_tel is not null and a.cliente_telefone = v_tel)
                or (p_chave like 'm:%' and coalesce(a.cliente_telefone, 'm:' || lower(a.cliente_nome) || ':' || a.dispositivo) = p_chave))
            order by a.criado_em desc limit 30) a
    ), '[]'::jsonb)
  );
end $$;
grant execute on function public.cliente_ficha(uuid, text) to authenticated;
