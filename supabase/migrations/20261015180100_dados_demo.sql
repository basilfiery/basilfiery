-- Restaurante de demonstração (só é criado se o banco ainda não tiver nenhum restaurante).
-- O primeiro administrador da plataforma vira dono dele automaticamente.
do $$
declare
  r uuid;
  c_ent uuid;
  c_piz uuid;
  c_mas uuid;
  c_sob uuid;
  c_beb uuid;
  i int;
begin
  if exists (select 1 from public.restaurantes) then
    return;
  end if;

  insert into public.restaurantes (nome, slogan, cor, plano)
  values ('Restaurante Demo', 'Manjericão fresco, fogo de verdade.', '#ff5a1f', 'profissional')
  returning id into r;

  insert into public.categorias (restaurante_id, nome, emoji, ordem) values (r, 'Entradas', '🥖', 1) returning id into c_ent;
  insert into public.categorias (restaurante_id, nome, emoji, ordem) values (r, 'Pizzas', '🍕', 2) returning id into c_piz;
  insert into public.categorias (restaurante_id, nome, emoji, ordem) values (r, 'Massas', '🍝', 3) returning id into c_mas;
  insert into public.categorias (restaurante_id, nome, emoji, ordem) values (r, 'Sobremesas', '🍰', 4) returning id into c_sob;
  insert into public.categorias (restaurante_id, nome, emoji, ordem) values (r, 'Bebidas', '🥤', 5) returning id into c_beb;

  insert into public.produtos
    (restaurante_id, categoria_id, nome, descricao, preco, emoji, vegetariano, picancia, destaque, novo, ordem, controla_estoque, estoque, estoque_minimo)
  values
    (r, c_ent, 'Bruschetta Clássica', 'Pão italiano tostado, tomate, alho, azeite extravirgem e manjericão fresco.', 32.90, '🍅', true, 0, false, false, 1, false, 0, 0),
    (r, c_ent, 'Burrata ao Pesto', 'Burrata cremosa, pesto de manjericão, tomates confitados e focaccia quentinha.', 54.90, '🧀', true, 0, true, false, 2, true, 12, 4),
    (r, c_ent, 'Asinhas Fiery', 'Asinhas de frango assadas no forno a lenha, glaceadas no mel com pimenta calabresa.', 42.90, '🍗', false, 2, false, false, 3, false, 0, 0),
    (r, c_ent, 'Polpettine al Sugo', 'Almôndegas artesanais ao molho de tomate com lascas de parmesão.', 39.90, '🧆', false, 0, false, false, 4, false, 0, 0),
    (r, c_piz, 'Margherita', 'Molho de tomate San Marzano, muçarela de búfala, manjericão e azeite.', 69.90, '🍕', true, 0, true, false, 1, false, 0, 0),
    (r, c_piz, 'Diavola', 'Pepperoni, muçarela, pimenta calabresa e um fio de mel picante.', 79.90, '🌶️', false, 2, true, false, 2, false, 0, 0),
    (r, c_piz, 'Fiery da Casa', 'Base de pesto, muçarela, linguiça artesanal, jalapeño e manjericão crocante.', 84.90, '🔥', false, 3, false, true, 3, false, 0, 0),
    (r, c_piz, 'Quattro Formaggi', 'Muçarela, gorgonzola, parmesão e provolone.', 76.90, '🧀', true, 0, false, false, 4, false, 0, 0),
    (r, c_mas, 'Spaghetti al Pomodoro', 'Molho de tomate fresco, alho dourado e manjericão.', 46.90, '🍝', true, 0, false, false, 1, false, 0, 0),
    (r, c_mas, 'Penne all''Arrabbiata', 'Molho de tomate com pimenta, alho e salsinha.', 49.90, '🌶️', true, 2, false, false, 2, false, 0, 0),
    (r, c_mas, 'Fettuccine ao Pesto', 'Pesto genovês de manjericão, pinoli tostados e parmesão.', 54.90, '🌿', true, 0, true, false, 3, false, 0, 0),
    (r, c_mas, 'Lasanha Bolonhesa', 'Ragu de carne cozido lentamente, molho bechamel e parmesão gratinado.', 58.90, '🥘', false, 0, false, false, 4, true, 10, 3),
    (r, c_sob, 'Tiramisù', 'Mascarpone, biscoito embebido no café e cacau.', 29.90, '☕', true, 0, false, false, 1, true, 8, 3),
    (r, c_sob, 'Panna Cotta de Manjericão', 'Creme delicado de manjericão com calda de morango.', 26.90, '🍮', true, 0, false, true, 2, true, 6, 2),
    (r, c_sob, 'Brownie Fiery', 'Chocolate meio amargo com um toque de pimenta e sorvete de creme.', 27.90, '🍫', true, 1, false, false, 3, false, 0, 0),
    (r, c_beb, 'Limonada de Manjericão', 'Limão siciliano, manjericão e gelo. 500 ml.', 14.90, '🍋', true, 0, true, false, 1, false, 0, 0),
    (r, c_beb, 'Italian Soda', 'Água com gás e xarope: maçã verde, frutas vermelhas ou tangerina.', 15.90, '🍹', true, 0, false, false, 2, false, 0, 0),
    (r, c_beb, 'Refrigerante lata', 'Coca-Cola, Coca-Cola Zero ou Guaraná. 350 ml.', 7.90, '🥤', true, 0, false, false, 3, true, 48, 12),
    (r, c_beb, 'Água mineral', 'Com ou sem gás. 500 ml.', 5.90, '💧', true, 0, false, false, 4, true, 36, 12),
    (r, c_beb, 'Cerveja artesanal', 'IPA ou Pilsen da casa. 500 ml.', 24.90, '🍺', true, 0, false, false, 5, true, 24, 6);

  for i in 1..10 loop
    insert into public.mesas (restaurante_id, nome, ordem) values (r, 'Mesa ' || i, i);
  end loop;
end $$;
