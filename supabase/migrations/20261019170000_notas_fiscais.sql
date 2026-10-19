-- Nota fiscal eletrônica: NFC-e (consumidor), NF-e (empresas e pessoas) e notas recebidas no CNPJ.
-- A comunicação com a SEFAZ passa pela Nuvem Fiscal (edge function "fiscal"); o certificado A1
-- vai direto para lá e não fica guardado no nosso banco.

create table if not exists public.fiscal_config (
  restaurante_id uuid primary key references public.restaurantes on delete cascade,
  ambiente text not null default 'homologacao' check (ambiente in ('homologacao', 'producao')),
  crt smallint not null default 1 check (crt in (1, 2, 3, 4)),
  cpf_cnpj text check (cpf_cnpj ~ '^\d{11}$|^\d{14}$'),
  razao_social text check (char_length(razao_social) <= 120),
  nome_fantasia text check (char_length(nome_fantasia) <= 120),
  inscricao_estadual text check (char_length(inscricao_estadual) <= 20),
  inscricao_municipal text check (char_length(inscricao_municipal) <= 20),
  email text check (char_length(email) <= 120),
  fone text check (char_length(fone) <= 20),
  logradouro text, numero text, complemento text, bairro text,
  cidade text, codigo_municipio text check (codigo_municipio ~ '^\d{7}$'), uf text check (uf ~ '^[A-Z]{2}$'), cep text check (cep ~ '^\d{8}$'),
  csc_id integer, csc text check (char_length(csc) <= 60),
  nfce_serie integer not null default 1, nfce_proximo integer not null default 1,
  nfe_serie integer not null default 1, nfe_proximo integer not null default 1,
  pis_cofins_cst text not null default '49',
  certificado_validade timestamptz, certificado_titular text,
  empresa_enviada_em timestamptz,
  emitir_auto boolean not null default false,
  atualizado_em timestamptz not null default now()
);
alter table public.fiscal_config enable row level security;
drop policy if exists "gestor vê fiscal" on public.fiscal_config;
create policy "gestor vê fiscal" on public.fiscal_config for select to authenticated using (public.tem_papel(restaurante_id, '{dono,gerente,caixa}'));
grant select on public.fiscal_config to authenticated;

-- Dados fiscais de cada produto
alter table public.produtos add column if not exists ncm text check (ncm is null or ncm ~ '^\d{8}$');
alter table public.produtos add column if not exists cfop text check (cfop is null or cfop ~ '^\d{4}$');
alter table public.produtos add column if not exists csosn text check (csosn is null or csosn ~ '^\d{2,3}$');
alter table public.produtos add column if not exists cest text check (cest is null or cest ~ '^\d{7}$');
alter table public.produtos add column if not exists unidade_fiscal text check (unidade_fiscal is null or char_length(unidade_fiscal) <= 6);
alter table public.produtos add column if not exists icms_aliquota numeric(5,2);
grant select (ncm, cfop, csosn, cest, unidade_fiscal, icms_aliquota), insert (ncm, cfop, csosn, cest, unidade_fiscal, icms_aliquota),
  update (ncm, cfop, csosn, cest, unidade_fiscal, icms_aliquota) on public.produtos to authenticated;

-- Notas emitidas pela loja
create table if not exists public.notas_fiscais (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes on delete cascade,
  pedido_id uuid references public.pedidos on delete set null,
  modelo smallint not null check (modelo in (55, 65)),
  ambiente text not null,
  status text not null default 'pendente',
  serie integer, numero integer,
  chave text, protocolo text,
  nuvem_id text,
  valor numeric(12,2) not null default 0,
  destinatario jsonb,
  motivo text,
  cancelada_em timestamptz,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists notas_fiscais_rest on public.notas_fiscais (restaurante_id, criado_em desc);
create index if not exists notas_fiscais_pedido on public.notas_fiscais (pedido_id);
alter table public.notas_fiscais enable row level security;
drop policy if exists "equipe vê notas" on public.notas_fiscais;
create policy "equipe vê notas" on public.notas_fiscais for select to authenticated using (public.tem_papel(restaurante_id, '{dono,gerente,caixa}'));
grant select on public.notas_fiscais to authenticated;

-- Notas emitidas por fornecedores contra o CNPJ da loja (entrada)
create table if not exists public.notas_recebidas (
  id uuid primary key default gen_random_uuid(),
  restaurante_id uuid not null references public.restaurantes on delete cascade,
  chave text not null,
  nuvem_documento_id text,
  resumo boolean not null default true,
  emitente_cnpj text, emitente_nome text, emitente_ie text,
  valor numeric(12,2),
  data_emissao timestamptz,
  manifestacao text,
  manifestada_em timestamptz,
  entrada_em timestamptz,
  entrada_por uuid,
  criado_em timestamptz not null default now(),
  unique (restaurante_id, chave)
);
alter table public.notas_recebidas enable row level security;
drop policy if exists "gestor vê recebidas" on public.notas_recebidas;
create policy "gestor vê recebidas" on public.notas_recebidas for select to authenticated using (public.tem_papel(restaurante_id, '{dono,gerente}'));
grant select on public.notas_recebidas to authenticated;

-- Dar entrada no estoque a partir dos itens de uma nota recebida
create or replace function public.nota_recebida_entrada(p_nota uuid, p_itens jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v public.notas_recebidas;
  i jsonb;
  n int := 0;
begin
  select * into v from public.notas_recebidas where id = p_nota for update;
  if not found or not public.tem_papel(v.restaurante_id, '{dono,gerente}') then raise exception 'Nota não encontrada'; end if;
  if v.entrada_em is not null then raise exception 'Esta nota já teve entrada no estoque'; end if;
  for i in select * from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) loop
    if (i ->> 'produto_id') is null or coalesce((i ->> 'qtd')::int, 0) <= 0 then continue; end if;
    if not exists (select 1 from public.produtos where id = (i ->> 'produto_id')::uuid and restaurante_id = v.restaurante_id) then continue; end if;
    update public.produtos set estoque = estoque + (i ->> 'qtd')::int, controla_estoque = true where id = (i ->> 'produto_id')::uuid;
    insert into public.movimentos_estoque (restaurante_id, produto_id, delta, motivo, user_id)
    values (v.restaurante_id, (i ->> 'produto_id')::uuid, (i ->> 'qtd')::int,
            left('Entrada NF ' || coalesce(v.emitente_nome, '') || ' · ' || right(v.chave, 9), 120), auth.uid());
    -- Custo do produto vem da nota, quando informado
    if (i ->> 'custo') is not null and (i ->> 'custo')::numeric > 0 then
      update public.produtos set custo = round((i ->> 'custo')::numeric, 2) where id = (i ->> 'produto_id')::uuid;
    end if;
    n := n + 1;
  end loop;
  update public.notas_recebidas set entrada_em = now(), entrada_por = auth.uid() where id = v.id;
  return n;
end $$;
revoke execute on function public.nota_recebida_entrada(uuid, jsonb) from public;
grant execute on function public.nota_recebida_entrada(uuid, jsonb) to authenticated;
