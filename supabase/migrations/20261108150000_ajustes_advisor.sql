-- Ajustes apontados pela revisão do Supabase (segurança e desempenho). Não muda o funcionamento.

-- Funções com caminho de busca fixo (ninguém consegue "trocar" o que elas enxergam)
alter function public.pasta_restaurante(text) set search_path = '';
alter function privado.slugificar(text) set search_path = '';

-- Índices nas ligações entre tabelas (consultas e exclusões continuam rápidas com o volume crescendo)
create index if not exists assinaturas_restaurante_id_idx on public.assinaturas (restaurante_id);
create index if not exists categorias_grupo_id_idx on public.categorias (grupo_id);
create index if not exists clientes_lojas_restaurante_id_idx on public.clientes_lojas (restaurante_id);
create index if not exists compras_itens_pessoa_id_idx on public.compras_itens (pessoa_id);
create index if not exists itens_cancelados_restaurante_id_idx on public.itens_cancelados (restaurante_id);
create index if not exists mesa_acessos_movido_de_idx on public.mesa_acessos (movido_de);
create index if not exists mesa_acessos_respondido_por_idx on public.mesa_acessos (respondido_por);
create index if not exists suporte_avaliacoes_restaurante_id_idx on public.suporte_avaliacoes (restaurante_id);

-- Perfil do cliente: o usuário logado é calculado uma vez por consulta, não uma vez por linha
alter policy "cliente vê o próprio perfil" on public.clientes_perfis using (user_id = (select auth.uid()));
alter policy "cliente cria o próprio perfil" on public.clientes_perfis with check (user_id = (select auth.uid()));
alter policy "cliente edita o próprio perfil" on public.clientes_perfis using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
