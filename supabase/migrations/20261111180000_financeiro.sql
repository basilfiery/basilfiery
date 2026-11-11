-- Financeiro da empresa: lançamentos (despesas e receitas), contas a pagar, folha de pagamento e contas fixas.
-- Só dono e gerente veem e mexem.

create table if not exists public.fin_funcionarios (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  nome text not null check (char_length(trim(nome)) between 2 and 80),
  cargo text,
  salario numeric(10,2) not null default 0 check (salario >= 0),
  dia_pagamento smallint not null default 5 check (dia_pagamento between 1 and 31),
  admissao date,
  telefone text,
  pix text,
  ativo boolean not null default true,
  observacao text,
  criado_em timestamptz not null default now()
);

create table if not exists public.fin_contas_fixas (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  descricao text not null check (char_length(trim(descricao)) between 2 and 80),
  categoria text not null,
  valor numeric(10,2) not null check (valor > 0),
  dia_vencimento smallint not null default 10 check (dia_vencimento between 1 and 31),
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table if not exists public.fin_lancamentos (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes(id) on delete cascade,
  tipo text not null default 'despesa' check (tipo in ('despesa', 'receita')),
  categoria text not null,
  descricao text not null check (char_length(trim(descricao)) between 1 and 160),
  valor numeric(12,2) not null check (valor > 0),
  data date not null default ((now() at time zone 'America/Sao_Paulo')::date),
  vencimento date,
  pago boolean not null default true,
  pago_em date,
  forma text,
  fornecedor text,
  funcionario_id uuid references public.fin_funcionarios(id) on delete set null,
  conta_fixa_id uuid references public.fin_contas_fixas(id) on delete set null,
  -- Gerado sozinho (conta fixa / salário do mês): evita duplicar
  chave_auto text,
  comprovante_path text,
  itens jsonb,
  origem text not null default 'manual' check (origem in ('manual', 'whatsapp', 'sistema')),
  observacao text,
  criado_por uuid default auth.uid(),
  criado_por_nome text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists fin_lanc_chave_idx on public.fin_lancamentos (restaurante_id, chave_auto) where chave_auto is not null;
create index if not exists fin_lanc_data_idx on public.fin_lancamentos (restaurante_id, data desc);
create index if not exists fin_lanc_aberto_idx on public.fin_lancamentos (restaurante_id, vencimento) where not pago;
create index if not exists fin_lanc_func_idx on public.fin_lancamentos (funcionario_id) where funcionario_id is not null;
create index if not exists fin_lanc_fixa_idx on public.fin_lancamentos (conta_fixa_id) where conta_fixa_id is not null;
create index if not exists fin_func_rest_idx on public.fin_funcionarios (restaurante_id);
create index if not exists fin_fixas_rest_idx on public.fin_contas_fixas (restaurante_id);

-- Quem lançou + data do pagamento coerente
create or replace function privado.fin_lanc_antes()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if tg_op = 'INSERT' and new.criado_por_nome is null and auth.uid() is not null then
    new.criado_por_nome := public.nome_membro(new.restaurante_id);
  end if;
  -- Pago agora: data do pagamento = hoje (ao lançar já pago: a data da compra)
  if new.pago and new.pago_em is null then
    new.pago_em := case when tg_op = 'UPDATE' then (now() at time zone 'America/Sao_Paulo')::date else new.data end;
  end if;
  if not new.pago then new.pago_em := null; end if;
  new.atualizado_em := now();
  return new;
end $$;
drop trigger if exists fin_lanc_antes on public.fin_lancamentos;
create trigger fin_lanc_antes before insert or update on public.fin_lancamentos for each row execute function privado.fin_lanc_antes();

alter table public.fin_funcionarios enable row level security;
alter table public.fin_contas_fixas enable row level security;
alter table public.fin_lancamentos enable row level security;
do $$
declare t text;
begin
  foreach t in array array['fin_funcionarios', 'fin_contas_fixas', 'fin_lancamentos'] loop
    execute format('drop policy if exists "gestao financeiro" on public.%I', t);
    execute format('create policy "gestao financeiro" on public.%I for all to authenticated using (public.tem_papel(restaurante_id, ''{dono,gerente}'')) with check (public.tem_papel(restaurante_id, ''{dono,gerente}''))', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Gera as contas do mês: contas fixas e salários (a pagar), sem duplicar
create or replace function public.fin_gerar_mes(p_rest uuid, p_mes date)
returns int language plpgsql security definer set search_path to '' as $$
declare
  v_ini date := date_trunc('month', p_mes)::date;
  v_ult int := extract(day from (date_trunc('month', p_mes) + interval '1 month - 1 day'))::int;
  v_ref text := to_char(p_mes, 'YYYY-MM');
  v_n int := 0;
  v_k int;
begin
  if not public.tem_papel(p_rest, '{dono,gerente}') then raise exception 'Sem permissão'; end if;
  insert into public.fin_lancamentos (restaurante_id, tipo, categoria, descricao, valor, data, vencimento, pago, conta_fixa_id, chave_auto, origem, criado_por_nome)
  select p_rest, 'despesa', f.categoria, f.descricao, f.valor, v_ini, v_ini + (least(f.dia_vencimento, v_ult) - 1), false, f.id,
         'fixa:' || f.id || ':' || v_ref, 'sistema', 'Conta fixa'
  from public.fin_contas_fixas f
  where f.restaurante_id = p_rest and f.ativo and f.criado_em < (v_ini + interval '1 month')
  on conflict (restaurante_id, chave_auto) where chave_auto is not null do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  insert into public.fin_lancamentos (restaurante_id, tipo, categoria, descricao, valor, data, vencimento, pago, funcionario_id, chave_auto, origem, criado_por_nome)
  select p_rest, 'despesa', 'Folha de pagamento', 'Salário · ' || u.nome, u.salario, v_ini, v_ini + (least(u.dia_pagamento, v_ult) - 1), false, u.id,
         'salario:' || u.id || ':' || v_ref, 'sistema', 'Folha de pagamento'
  from public.fin_funcionarios u
  where u.restaurante_id = p_rest and u.ativo and u.salario > 0 and coalesce(u.admissao, '1900-01-01') < (v_ini + interval '1 month')
  on conflict (restaurante_id, chave_auto) where chave_auto is not null do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;
  return v_n;
end $$;

-- Visão geral do mês (ou de um período): vendas do sistema, despesas, contas a pagar e o saldo estimado
create or replace function public.fin_resumo(p_rest uuid, p_inicio date, p_fim date)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_tz text;
  v_ini timestamptz;
  v_fim timestamptz;
  v_hoje date;
begin
  if not public.tem_papel(p_rest, '{dono,gerente}') then raise exception 'Sem permissão'; end if;
  select coalesce(nullif(fuso, ''), 'America/Sao_Paulo') into v_tz from public.restaurantes where id = p_rest;
  v_ini := p_inicio::timestamp at time zone v_tz;
  v_fim := (p_fim + 1)::timestamp at time zone v_tz;
  v_hoje := (now() at time zone v_tz)::date;
  return jsonb_build_object(
    'hoje', v_hoje,
    -- Vendas: pedidos não cancelados do período (mesa, balcão, delivery)
    'vendas', (select jsonb_build_object('total', coalesce(sum(total), 0), 'pedidos', count(*))
               from public.pedidos where restaurante_id = p_rest and status <> 'cancelado' and criado_em >= v_ini and criado_em < v_fim),
    'vendas_ate_hoje', (select coalesce(sum(total), 0) from public.pedidos where restaurante_id = p_rest and status <> 'cancelado'
                        and criado_em >= v_ini and criado_em < least(v_fim, ((v_hoje + 1)::timestamp at time zone v_tz))),
    'recebido_por_forma', coalesce((select jsonb_object_agg(forma, total) from (
        select forma, sum(valor) total from public.pagamentos where restaurante_id = p_rest and criado_em >= v_ini and criado_em < v_fim group by 1) f), '{}'::jsonb),
    -- Corridas dos entregadores (custo automático do app de entregas)
    'corridas', (select coalesce(sum(taxa_entregador), 0) from public.pedidos where restaurante_id = p_rest and tipo = 'delivery'
                 and status = 'entregue' and criado_em >= v_ini and criado_em < v_fim),
    'despesas_pagas', (select coalesce(sum(valor), 0) from public.fin_lancamentos where restaurante_id = p_rest and tipo = 'despesa' and pago
                       and pago_em between p_inicio and p_fim),
    'despesas_a_pagar', (select coalesce(sum(valor), 0) from public.fin_lancamentos where restaurante_id = p_rest and tipo = 'despesa' and not pago
                         and coalesce(vencimento, data) between p_inicio and p_fim),
    'vencidas', (select jsonb_build_object('total', coalesce(sum(valor), 0), 'qtd', count(*)) from public.fin_lancamentos
                 where restaurante_id = p_rest and tipo = 'despesa' and not pago and coalesce(vencimento, data) < v_hoje),
    'receitas', (select coalesce(sum(valor), 0) from public.fin_lancamentos where restaurante_id = p_rest and tipo = 'receita'
                 and coalesce(pago_em, data) between p_inicio and p_fim),
    'por_categoria', coalesce((select jsonb_agg(jsonb_build_object('categoria', categoria, 'total', total, 'pago', pago) order by total desc) from (
        select categoria, sum(valor) total, sum(valor) filter (where pago) pago from public.fin_lancamentos
        where restaurante_id = p_rest and tipo = 'despesa' and (case when pago then pago_em else coalesce(vencimento, data) end) between p_inicio and p_fim
        group by 1) c), '[]'::jsonb),
    'por_dia', coalesce((select jsonb_agg(jsonb_build_object('dia', d, 'vendas', v, 'despesas', g) order by d) from (
        select dd::date d,
          (select coalesce(sum(total), 0) from public.pedidos where restaurante_id = p_rest and status <> 'cancelado'
             and criado_em >= (dd::timestamp at time zone v_tz) and criado_em < ((dd + interval '1 day')::timestamp at time zone v_tz)) v,
          (select coalesce(sum(valor), 0) from public.fin_lancamentos where restaurante_id = p_rest and tipo = 'despesa' and pago and pago_em = dd::date) g
        from generate_series(p_inicio, least(p_fim, v_hoje), interval '1 day') dd) x), '[]'::jsonb)
  );
end $$;
revoke execute on function public.fin_gerar_mes(uuid, date), public.fin_resumo(uuid, date, date) from anon, public;
grant execute on function public.fin_gerar_mes(uuid, date), public.fin_resumo(uuid, date, date) to authenticated;

-- Comprovantes (fotos de notas e recibos): pasta da loja, privado, só gestão
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('financeiro', 'financeiro', false, 15728640, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do nothing;
drop policy if exists "financeiro ve comprovante" on storage.objects;
drop policy if exists "financeiro envia comprovante" on storage.objects;
drop policy if exists "financeiro apaga comprovante" on storage.objects;
create policy "financeiro ve comprovante" on storage.objects for select to authenticated
  using (bucket_id = 'financeiro' and public.tem_papel(public.uuid_ou_nulo((storage.foldername(name))[1]), '{dono,gerente}'));
create policy "financeiro envia comprovante" on storage.objects for insert to authenticated
  with check (bucket_id = 'financeiro' and public.tem_papel(public.uuid_ou_nulo((storage.foldername(name))[1]), '{dono,gerente}'));
create policy "financeiro apaga comprovante" on storage.objects for delete to authenticated
  using (bucket_id = 'financeiro' and public.tem_papel(public.uuid_ou_nulo((storage.foldername(name))[1]), '{dono,gerente}'));
