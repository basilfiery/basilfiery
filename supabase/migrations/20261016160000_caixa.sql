-- Abertura e fechamento de caixa + forma de pagamento ao fechar a conta da mesa

create table public.caixas (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes on delete cascade,
  aberto_em timestamptz not null default now(),
  aberto_por uuid references auth.users on delete set null,
  aberto_por_nome text,
  valor_inicial numeric(10,2) not null default 0 check (valor_inicial >= 0),
  fechado_em timestamptz,
  fechado_por uuid references auth.users on delete set null,
  fechado_por_nome text,
  valor_contado numeric(10,2),
  observacao text,
  resumo jsonb
);
-- No máximo um caixa aberto por restaurante
create unique index caixas_um_aberto on public.caixas (restaurante_id) where fechado_em is null;
create index on public.caixas (restaurante_id, aberto_em desc);
create index on public.caixas (aberto_por);
create index on public.caixas (fechado_por);

create table public.pagamentos (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes on delete cascade,
  caixa_id uuid references public.caixas on delete set null,
  mesa_id uuid references public.mesas on delete set null,
  mesa_nome text not null,
  forma text not null check (forma in ('dinheiro', 'pix', 'credito', 'debito', 'outro')),
  valor numeric(10,2) not null,
  user_id uuid references auth.users on delete set null default auth.uid(),
  criado_em timestamptz not null default now()
);
create index on public.pagamentos (caixa_id);
create index on public.pagamentos (restaurante_id, criado_em desc);
create index on public.pagamentos (mesa_id);
create index on public.pagamentos (user_id);

alter table public.pedidos add column pagamento_id uuid references public.pagamentos on delete set null;
create index on public.pedidos (pagamento_id);

alter table public.caixas enable row level security;
alter table public.pagamentos enable row level security;
revoke all on public.caixas, public.pagamentos from anon;
revoke insert, update, delete on public.caixas, public.pagamentos from authenticated;
create policy "ver caixas" on public.caixas for select to authenticated using (public.eh_membro(restaurante_id));
create policy "ver pagamentos" on public.pagamentos for select to authenticated using (public.eh_membro(restaurante_id));

alter publication supabase_realtime add table public.caixas;

-- Nome de quem está agindo (para o histórico do caixa)
create function public.nome_membro(p_rest uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select nome from public.membros where restaurante_id = p_rest and user_id = (select auth.uid())),
    (select email from auth.users where id = (select auth.uid()))
  );
$$;

-- Resumo de um caixa até um instante (usado ao vivo e no fechamento)
create function public.caixa_resumo(p_caixa uuid, p_ate timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.caixas;
  v_formas jsonb;
  v_recebido numeric;
  v_dinheiro numeric;
  v_contas int;
begin
  select * into c from public.caixas where id = p_caixa;
  if not found or not public.eh_membro(c.restaurante_id) then raise exception 'Caixa não encontrado'; end if;

  select coalesce(jsonb_object_agg(forma, total), '{}'::jsonb), coalesce(sum(total), 0), coalesce(sum(n), 0)
  into v_formas, v_recebido, v_contas
  from (
    select forma, sum(valor) as total, count(*) as n
    from public.pagamentos where caixa_id = c.id group by forma
  ) f;
  v_dinheiro := coalesce((v_formas ->> 'dinheiro')::numeric, 0);

  return jsonb_build_object(
    'caixa_id', c.id,
    'aberto_em', c.aberto_em,
    'aberto_por_nome', c.aberto_por_nome,
    'valor_inicial', c.valor_inicial,
    'ate', p_ate,
    'vendas', (
      select jsonb_build_object('pedidos', count(*), 'total', coalesce(sum(total), 0))
      from public.pedidos
      where restaurante_id = c.restaurante_id and status <> 'cancelado'
        and criado_em >= c.aberto_em and criado_em < p_ate
    ),
    'cancelados', (
      select jsonb_build_object('pedidos', count(*), 'total', coalesce(sum(total), 0))
      from public.pedidos
      where restaurante_id = c.restaurante_id and status = 'cancelado'
        and criado_em >= c.aberto_em and criado_em < p_ate
    ),
    'recebido', v_recebido,
    'contas_fechadas', v_contas,
    'por_forma', v_formas,
    'dinheiro_esperado', c.valor_inicial + v_dinheiro,
    'em_aberto', (
      select jsonb_build_object('mesas', count(distinct mesa_id), 'total', coalesce(sum(total), 0))
      from public.pedidos
      where restaurante_id = c.restaurante_id and status <> 'cancelado' and pago_em is null
    )
  );
end $$;

-- Caixa aberto agora (ou null) com o resumo ao vivo
create function public.caixa_atual(p_rest uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not public.eh_membro(p_rest) then raise exception 'Sem permissão'; end if;
  select id into v_id from public.caixas where restaurante_id = p_rest and fechado_em is null;
  if v_id is null then return null; end if;
  return public.caixa_resumo(v_id, now());
end $$;

create function public.caixa_abrir(p_rest uuid, p_valor_inicial numeric default 0) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not public.tem_papel(p_rest, '{dono,gerente,caixa}') then raise exception 'Sem permissão para abrir o caixa'; end if;
  if exists (select 1 from public.caixas where restaurante_id = p_rest and fechado_em is null) then
    raise exception 'O caixa já está aberto';
  end if;
  insert into public.caixas (restaurante_id, aberto_por, aberto_por_nome, valor_inicial)
  values (p_rest, (select auth.uid()), public.nome_membro(p_rest), greatest(coalesce(p_valor_inicial, 0), 0))
  returning id into v_id;
  return v_id;
end $$;

create function public.caixa_fechar(p_caixa uuid, p_valor_contado numeric default null, p_obs text default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  c public.caixas;
  v_resumo jsonb;
begin
  select * into c from public.caixas where id = p_caixa for update;
  if not found or not public.tem_papel(c.restaurante_id, '{dono,gerente,caixa}') then
    raise exception 'Sem permissão para fechar o caixa';
  end if;
  if c.fechado_em is not null then raise exception 'Este caixa já foi fechado'; end if;

  v_resumo := public.caixa_resumo(c.id, now());
  v_resumo := v_resumo || jsonb_build_object(
    'valor_contado', p_valor_contado,
    'diferenca', case when p_valor_contado is null then null
                      else p_valor_contado - (v_resumo ->> 'dinheiro_esperado')::numeric end,
    'fechado_por_nome', public.nome_membro(c.restaurante_id),
    'observacao', nullif(trim(p_obs), '')
  );

  update public.caixas set
    fechado_em = now(),
    fechado_por = (select auth.uid()),
    fechado_por_nome = public.nome_membro(c.restaurante_id),
    valor_contado = p_valor_contado,
    observacao = nullif(trim(p_obs), ''),
    resumo = v_resumo
  where id = c.id;

  return v_resumo;
end $$;

-- Fechar a conta da mesa agora registra a forma de pagamento no caixa aberto
drop function public.mesa_fechar_conta(uuid);
create function public.mesa_fechar_conta(p_mesa uuid, p_forma text default 'outro') returns numeric
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_mesa public.mesas;
  v_caixa uuid;
  v_total numeric;
  v_pag uuid;
begin
  select * into v_mesa from public.mesas where id = p_mesa;
  if not found or not public.tem_papel(v_mesa.restaurante_id, '{dono,gerente,caixa}') then
    raise exception 'Sem permissão para fechar contas';
  end if;
  if p_forma not in ('dinheiro', 'pix', 'credito', 'debito', 'outro') then raise exception 'Forma de pagamento inválida'; end if;

  select id into v_caixa from public.caixas where restaurante_id = v_mesa.restaurante_id and fechado_em is null;
  if v_caixa is null then raise exception 'Abra o caixa antes de receber pagamentos'; end if;

  select coalesce(sum(total), 0) into v_total
  from public.pedidos where mesa_id = p_mesa and pago_em is null and status <> 'cancelado';

  if v_total > 0 then
    insert into public.pagamentos (restaurante_id, caixa_id, mesa_id, mesa_nome, forma, valor)
    values (v_mesa.restaurante_id, v_caixa, v_mesa.id, v_mesa.nome, p_forma, v_total)
    returning id into v_pag;
  end if;

  update public.pedidos set pago_em = now(), pagamento_id = case when status = 'cancelado' then null else v_pag end
  where mesa_id = p_mesa and pago_em is null;
  update public.chamados set atendido_em = now() where mesa_id = p_mesa and atendido_em is null;
  return v_total;
end $$;

revoke execute on function
  public.nome_membro(uuid),
  public.caixa_resumo(uuid, timestamptz),
  public.caixa_atual(uuid),
  public.caixa_abrir(uuid, numeric),
  public.caixa_fechar(uuid, numeric, text),
  public.mesa_fechar_conta(uuid, text)
from public, anon;

grant execute on function
  public.caixa_resumo(uuid, timestamptz),
  public.caixa_atual(uuid),
  public.caixa_abrir(uuid, numeric),
  public.caixa_fechar(uuid, numeric, text),
  public.mesa_fechar_conta(uuid, text)
to authenticated;
