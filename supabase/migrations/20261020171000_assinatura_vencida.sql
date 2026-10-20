-- Quem cancelou continua usando até o fim do período pago; depois disso a loja é suspensa.
create extension if not exists pg_cron;

create or replace function privado.suspender_assinaturas_vencidas()
returns void language sql security definer set search_path = public as $$
  update restaurantes r set ativo = false
    from assinaturas a
   where a.restaurante_id = r.id and r.ativo
     and a.status in ('cancelada', 'expirada', 'reembolsada')
     and (a.vence_em is null or a.vence_em < now());
$$;

select cron.unschedule('suspender-assinaturas') where exists (select 1 from cron.job where jobname = 'suspender-assinaturas');
select cron.schedule('suspender-assinaturas', '15 * * * *', 'select privado.suspender_assinaturas_vencidas()');
