-- Assinaturas vendidas pela Kirvano: o webhook grava aqui e o cliente cria o
-- próprio acesso (e-mail + CPF/CNPJ da compra) em basilfiery.com.br/ativar.

create table if not exists public.assinaturas (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  nome text,
  telefone text,
  documento text,
  plano text,
  valor numeric(10, 2),
  forma text,
  status text not null default 'ativa' check (status in ('ativa', 'atrasada', 'cancelada', 'expirada', 'reembolsada')),
  vence_em timestamptz,
  venda_id text,
  produto_id text,
  oferta_id text,
  restaurante_id uuid references public.restaurantes(id) on delete set null,
  user_id uuid,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.assinatura_eventos (
  id bigint generated always as identity primary key,
  recebido_em timestamptz not null default now(),
  evento text,
  email text,
  venda_id text,
  tratado boolean not null default false,
  payload jsonb
);

alter table public.assinaturas enable row level security;
alter table public.assinatura_eventos enable row level security;

-- Só o administrador da plataforma enxerga (o webhook e a ativação usam a service role)
drop policy if exists assinaturas_admin on public.assinaturas;
create policy assinaturas_admin on public.assinaturas for select to authenticated using (public.eh_admin_plataforma());
drop policy if exists assinatura_eventos_admin on public.assinatura_eventos;
create policy assinatura_eventos_admin on public.assinatura_eventos for select to authenticated using (public.eh_admin_plataforma());
revoke all on public.assinaturas, public.assinatura_eventos from anon;
grant select on public.assinaturas, public.assinatura_eventos to authenticated;

-- Marca do sistema (menu lateral): BasilFiery, logo + nome próprios, ou só uma imagem larga
alter table public.restaurantes add column if not exists marca_sistema jsonb;
grant update (marca_sistema) on public.restaurantes to authenticated;
