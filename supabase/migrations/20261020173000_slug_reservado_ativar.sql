-- /ativar (criar acesso depois de assinar) não pode virar endereço de loja
create or replace function privado.slug_reservado(p text)
returns boolean language sql immutable as $$
  select p ~ '^mesa[0-9]*$' or p = any (array[
    'loja','login','entrar','cadastro','ativar','assinar','assinatura','baixar','download','termos','privacidade','dono','g','garcom','garcons','lista','colaboradores',
    'plataforma','painel','admin','app','apps','api','assets','delivery','pedido','pedidos','suporte','ajuda',
    'contato','planos','precos','blog','www','site','basil','sw','manifest','versao','static','public','conta','perfil'
  ])
$$;
