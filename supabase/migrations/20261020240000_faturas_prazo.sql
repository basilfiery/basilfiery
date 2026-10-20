-- Faturas automáticas (Kirvano) e prazo de 5 dias depois do vencimento antes de bloquear

alter table public.faturas add column if not exists forma text check (char_length(forma) <= 40);
alter table public.faturas add column if not exists venda_id text;
alter table public.faturas add column if not exists plano text check (char_length(plano) <= 60);
create unique index if not exists faturas_venda_id on public.faturas (venda_id) where venda_id is not null;

-- Vencido há mais de 5 dias sem pagar (Pix/boleto ou cartão recusado) → suspende.
-- Cancelou: usa até o fim do período pago. Reembolso/chargeback: já suspende no webhook.
create or replace function privado.suspender_assinaturas_vencidas()
returns void language sql security definer set search_path = public as $$
  update restaurantes r set ativo = false
    from assinaturas a
   where a.restaurante_id = r.id and r.ativo
     and (
       (a.status in ('cancelada', 'expirada', 'reembolsada') and (a.vence_em is null or a.vence_em < now()))
       or (a.status in ('ativa', 'atrasada') and a.vence_em is not null and a.vence_em + interval '5 days' < now())
     );
$$;
