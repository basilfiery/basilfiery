import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Camera, Check, CircleCheck, Clock, CreditCard, ExternalLink, FileText, KeyRound, MessageCircle, Receipt, Store, UserRound, Wallet } from 'lucide-react';
import { Campo } from '../../componentes/Basicos';
import { Avatar, ModalPerfil } from '../../componentes/Perfil';
import { useToast } from '../../componentes/Toast';
import { SITE } from '../../config/site';
import { useSessao } from '../../lib/sessao';
import { msgErro, supabase } from '../../lib/supabase';
import type { Fatura } from '../../lib/tipos';
import { DIAS_TOLERANCIA, dataBR, ehCartao, linkPagarPlano, situacaoPlano } from '../../lib/fatura';
import { brl, cx } from '../../lib/util';
import { usePainel } from './Painel';

const PLANO_ROTULO: Record<string, string> = { teste: 'Teste gratuito', start: 'Start', premium: 'Premium', rede: 'Rede', essencial: 'Start', profissional: 'Premium' };
const data = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '—');
const whatsSuporte = (texto: string) => (SITE.whatsappVendas ? `https://wa.me/${SITE.whatsappVendas}?text=${encodeURIComponent(texto)}` : '');

const ABAS = [
  { id: '', rotulo: 'Geral' },
  { id: 'pessoais', rotulo: 'Informações pessoais' },
  { id: 'pagamento', rotulo: 'Formas de pagamento' },
  { id: 'faturas', rotulo: 'Fatura' },
];

export default function Conta() {
  const { aba = '' } = useParams();
  const atual = ABAS.find((a) => a.id === aba) ?? ABAS[0];
  return (
    <div className="pagina conta">
      <div className="pagina__cab conta__cab">
        <div>
          <h1 className="titulo">Minha conta</h1>
          <nav className="conta__trilha" aria-label="Caminho"><span>Minha conta</span><span>›</span><b>{atual.rotulo}</b></nav>
        </div>
      </div>
      <nav className="conta__abas" aria-label="Seções da conta">
        {ABAS.map((a) => (
          <Link key={a.id} to={`/painel/conta${a.id ? `/${a.id}` : ''}`} className={cx(atual.id === a.id && 'ativo')}>{a.rotulo}</Link>
        ))}
      </nav>
      {atual.id === '' && <Geral />}
      {atual.id === 'pessoais' && <Pessoais />}
      {atual.id === 'pagamento' && <Pagamento />}
      {atual.id === 'faturas' && <Faturas />}
    </div>
  );
}

/* ---------- Geral: o plano ---------- */
function Geral() {
  const { restaurante: r } = usePainel();
  const plano = SITE.planos.find((p) => p.nome.toLowerCase() === (r.plano ?? '').toLowerCase());
  const vencido = !!r.plano_vence_em && new Date(`${r.plano_vence_em}T23:59:59`) < new Date();
  const nomePlano = PLANO_ROTULO[r.plano] ?? r.plano;
  const recursos = plano?.itens ?? [];
  const sugestao = whatsSuporte(`Olá! Tenho uma sugestão para o ${SITE.marca} (${r.nome}): `);
  const cancelar = whatsSuporte(`Olá! Quero falar sobre o cancelamento do plano do ${r.nome}.`);

  return (
    <>
      <section className="card conta-plano">
        <header className="conta-plano__cab">
          <h2><span>Meu plano:</span> {SITE.marca} {nomePlano}</h2>
          {r.ativo && !vencido
            ? <span className="badge badge--verde"><CircleCheck size={13} /> {r.plano === 'teste' ? 'Teste ativo' : 'Plano ativo'}</span>
            : <span className="badge badge--vermelho">{vencido ? 'Vencido' : 'Suspenso'}</span>}
        </header>
        <div className="conta-plano__dados">
          <div><small>Valor</small><strong>{r.plano_valor != null ? `${brl(Number(r.plano_valor))} / mês` : plano?.preco ? `${plano.preco}${plano.periodo ?? ''}` : '—'}</strong></div>
          <div><small>Vencimento do plano</small><strong className={cx(vencido && 'perigo')}>{data(r.plano_vence_em)}</strong></div>
          <div><small>Forma de pagamento</small><strong>{r.plano_forma || 'Pix ou boleto'}</strong></div>
        </div>
        {recursos.length > 0 && (
          <ul className="conta-plano__recursos">
            {recursos.map((x) => <li key={x}><Check size={18} /> {x}</li>)}
          </ul>
        )}
        <footer className="conta-plano__rodape">
          {cancelar
            ? <a href={cancelar} target="_blank" rel="noopener">Cancelar plano</a>
            : <span className="muted">Para mudar ou cancelar o plano, fale com o suporte {SITE.marca}.</span>}
        </footer>
      </section>
      <p className="conta-sugestao">
        Queremos construir a melhor plataforma para você. Tem alguma sugestão?{' '}
        {sugestao ? <a href={sugestao} target="_blank" rel="noopener">Envie pra gente!</a> : <b>Fale com o suporte.</b>}
      </p>
    </>
  );
}

/* ---------- Informações pessoais ---------- */
function Pessoais() {
  const s = useSessao();
  const toast = useToast();
  const { restaurante: r } = usePainel();
  const [editarFoto, setEditarFoto] = useState(false);
  const [telefone, setTelefone] = useState<string>(() => (s.usuario?.user_metadata?.telefone as string | undefined) ?? '');
  const [rest, setRest] = useState({ nome: r.nome, whatsapp: r.whatsapp ?? '', endereco: r.endereco ?? '' });
  const [salvando, setSalvando] = useState(false);
  const [senha, setSenha] = useState({ nova: '', repetir: '' });
  const [trocando, setTrocando] = useState(false);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setSalvando(true);
    const [u, x] = await Promise.all([
      supabase.auth.updateUser({ data: { telefone: telefone.replace(/\D/g, '') } }),
      supabase.from('restaurantes').update({
        nome: rest.nome.trim(), whatsapp: rest.whatsapp.replace(/\D/g, '') || null, endereco: rest.endereco.trim() || null,
      }).eq('id', r.id),
    ]);
    setSalvando(false);
    const erro = u.error ?? x.error;
    if (erro) return toast(msgErro(erro), 'erro');
    toast('Informações salvas.', 'ok');
    void s.recarregar();
  }

  async function trocarSenha(e: FormEvent) {
    e.preventDefault();
    if (senha.nova.length < 6) return toast('A senha precisa ter pelo menos 6 caracteres.', 'erro');
    if (senha.nova !== senha.repetir) return toast('As senhas não são iguais.', 'erro');
    setTrocando(true);
    const { error } = await supabase.auth.updateUser({ password: senha.nova });
    setTrocando(false);
    if (error) return toast(msgErro(error), 'erro');
    setSenha({ nova: '', repetir: '' });
    toast('Senha alterada.', 'ok');
  }

  return (
    <div className="conta-grade">
      <form className="card conta-bloco" onSubmit={salvar}>
        <h2 className="card__titulo"><UserRound size={18} /> Seus dados</h2>
        <div className="conta-perfil">
          <Avatar nome={s.nome || 'Você'} foto={s.foto} tamanho={64} />
          <div>
            <strong>{s.nome}</strong>
            <small>{s.usuario?.email}</small>
          </div>
          <button type="button" className="btn btn--contorno btn--sm" onClick={() => setEditarFoto(true)}><Camera size={16} /> Foto e nome</button>
        </div>
        <div className="form-linha">
          <Campo rotulo="E-mail de acesso" dica="Para trocar o e-mail, fale com o suporte."><input className="input" value={s.usuario?.email ?? ''} disabled /></Campo>
          <Campo rotulo="Seu telefone"><input className="input" inputMode="tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="(11) 98765-4321" /></Campo>
        </div>
        <h2 className="card__titulo conta-bloco__sub"><Store size={18} /> Restaurante</h2>
        <Campo rotulo="Nome do restaurante"><input className="input" required maxLength={80} value={rest.nome} onChange={(e) => setRest({ ...rest, nome: e.target.value })} /></Campo>
        <div className="form-linha">
          <Campo rotulo="WhatsApp do restaurante" dica="Aparece no cardápio delivery para o cliente falar com você."><input className="input" inputMode="tel" value={rest.whatsapp} onChange={(e) => setRest({ ...rest, whatsapp: e.target.value })} placeholder="(11) 3333-4444" /></Campo>
          <Campo rotulo="Endereço" dica="Mostrado para quem vai retirar no balcão."><input className="input" maxLength={200} value={rest.endereco} onChange={(e) => setRest({ ...rest, endereco: e.target.value })} placeholder="Rua, número, bairro" /></Campo>
        </div>
        <div className="conta-bloco__acoes"><button className="btn btn--primario" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar informações'}</button></div>
      </form>

      <form className="card conta-bloco" onSubmit={trocarSenha}>
        <h2 className="card__titulo"><KeyRound size={18} /> Segurança</h2>
        <p className="muted conta-bloco__texto">Troque a senha de acesso ao sistema e aos apps.</p>
        <Campo rotulo="Nova senha"><input className="input" type="password" autoComplete="new-password" value={senha.nova} onChange={(e) => setSenha({ ...senha, nova: e.target.value })} /></Campo>
        <Campo rotulo="Repita a nova senha"><input className="input" type="password" autoComplete="new-password" value={senha.repetir} onChange={(e) => setSenha({ ...senha, repetir: e.target.value })} /></Campo>
        <div className="conta-bloco__acoes"><button className="btn btn--contorno" disabled={trocando || !senha.nova}>{trocando ? 'Alterando…' : 'Alterar senha'}</button></div>
      </form>
      {editarFoto && <ModalPerfil aoFechar={() => setEditarFoto(false)} />}
    </div>
  );
}

/* ---------- Formas de pagamento ---------- */
function Pagamento() {
  const { restaurante: r } = usePainel();
  const forma = r.plano_forma || 'Pix ou boleto';
  const cartao = /cart/i.test(forma);
  const trocar = whatsSuporte(`Olá! Quero trocar a forma de pagamento do plano do ${r.nome}.`);
  return (
    <section className="card conta-bloco conta-pagamento">
      <h2 className="card__titulo"><CreditCard size={18} /> Forma de pagamento do plano</h2>
      <div className="conta-forma">
        <span className="conta-forma__icone">{cartao ? <CreditCard size={22} /> : <Receipt size={22} />}</span>
        <div><strong>{forma}</strong><small>{r.plano_vence_em ? `Próximo vencimento: ${data(r.plano_vence_em)}` : 'Usada para pagar a mensalidade do sistema.'}</small></div>
        <span className="badge badge--verde">Atual</span>
      </div>
      <p className="muted conta-bloco__texto">
        A mensalidade do {SITE.marca} é cobrada pelo nosso time. Não guardamos dados de cartão aqui no sistema.
        Para trocar a forma de pagamento, é só chamar a gente.
      </p>
      {trocar
        ? <a className="btn btn--contorno conta-pagamento__botao" href={trocar} target="_blank" rel="noopener"><MessageCircle size={17} /> Trocar forma de pagamento</a>
        : <p className="muted conta-bloco__texto">Fale com o suporte {SITE.marca} para trocar.</p>}
    </section>
  );
}

/* ---------- Fatura: plano atual + histórico ---------- */
function Faturas() {
  const toast = useToast();
  const { restaurante: r } = usePainel();
  const [lista, setLista] = useState<Fatura[] | null>(null);
  useEffect(() => {
    void supabase.from('faturas').select('*').eq('restaurante_id', r.id).order('vencimento', { ascending: false })
      .then(({ data, error }) => {
        if (error) toast(msgErro(error), 'erro');
        setLista((data ?? []) as Fatura[]);
      });
  }, [r.id, toast]);

  const sit = situacaoPlano(r);
  const pagar = linkPagarPlano(r.plano);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const status = (f: Fatura) => (f.pago_em ? 'paga' : new Date(`${f.vencimento}T23:59:59`) < hoje ? 'vencida' : 'aberta');
  const nomePlano = PLANO_ROTULO[r.plano] ?? r.plano;
  const cartao = ehCartao(r.plano_forma);

  return (
    <>
      <section className="card fat-plano">
        <span className="fat-plano__ilustra" aria-hidden="true"><Wallet size={34} /><CreditCard size={20} /></span>
        <div className="fat-plano__corpo">
          <header>
            <h2>Plano atual</h2>
            {sit.estado === 'em_dia' && <span className="badge badge--verde"><CircleCheck size={13} /> Em dia</span>}
            {sit.estado === 'perto' && <span className="badge badge--amarelo"><Clock size={13} /> Vence {sit.dias === 0 ? 'hoje' : sit.dias === 1 ? 'amanhã' : `em ${sit.dias} dias`}</span>}
            {sit.estado === 'vencida' && <span className="badge badge--vermelho">Vencida · pague até {dataBR(sit.limite)}</span>}
            {sit.estado === 'suspensa' && <span className="badge badge--vermelho">Suspensa</span>}
            {sit.estado === 'sem_cobranca' && <span className="badge">Sem cobrança</span>}
          </header>
          <dl className="fat-plano__dados">
            <div><dt>Vencimento do plano</dt><dd>{dataBR(sit.vence)}</dd></div>
            <div><dt>Valor</dt><dd>{r.plano_valor != null ? brl(Number(r.plano_valor)) : '—'}</dd></div>
            <div><dt>Forma de pagamento</dt><dd>{r.plano_forma || '—'}</dd></div>
            <div><dt>Plano</dt><dd>{SITE.marca} {nomePlano}</dd></div>
            <div><dt>Período</dt><dd>Mensal</dd></div>
          </dl>
          {(sit.estado === 'perto' || sit.estado === 'vencida' || sit.estado === 'suspensa') && (
            <div className={cx('fat-plano__pagar', sit.estado === 'perto' && 'fat-plano__pagar--perto')}>
              <p>
                {sit.estado === 'suspensa' ? 'Pague a mensalidade para liberar o sistema de novo.'
                  : sit.estado === 'vencida' ? <>A fatura venceu em <b>{dataBR(sit.vence)}</b>. Pague até <b>{dataBR(sit.limite)}</b> para evitar o bloqueio.</>
                    : <>Pague até <b>{dataBR(sit.vence)}</b>. Você ainda tem {DIAS_TOLERANCIA} dias de tolerância depois do vencimento.</>}
              </p>
              <a className="btn btn--primario" href={pagar} target={pagar.startsWith('http') ? '_blank' : undefined} rel="noopener">Pagar fatura <ExternalLink size={15} /></a>
            </div>
          )}
          {cartao && sit.estado === 'em_dia' && <p className="fat-plano__nota">A cobrança é automática no cartão, todo mês no dia do vencimento.</p>}
        </div>
      </section>

      <section className="card conta-bloco">
        <div className="fat-hist__cab">
          <h2 className="card__titulo"><FileText size={18} /> Histórico de faturas</h2>
          {lista && <small className="muted">Total de {lista.length} {lista.length === 1 ? 'registro' : 'registros'}</small>}
        </div>
        {!lista ? <div className="spinner" style={{ margin: '24px auto' }} /> : lista.length === 0 ? (
          <div className="conta-vazio">
            <Receipt size={30} />
            <strong>Nenhuma fatura por aqui</strong>
            <p>{sit.estado === 'sem_cobranca' ? 'Esta conta não tem mensalidade.' : 'Cada pagamento da mensalidade aparece aqui.'}</p>
          </div>
        ) : (
          <div className="tabela-wrap">
            <table className="tabela fat-tabela">
              <thead><tr><th>Data de vencimento</th><th>Forma de pagamento</th><th>Referência</th><th className="num">Valor</th><th>Status</th><th /></tr></thead>
              <tbody>
                {lista.map((f) => {
                  const st = status(f);
                  const forma = f.forma || r.plano_forma || '—';
                  return (
                    <tr key={f.id}>
                      <td><strong>{data(f.vencimento)}</strong></td>
                      <td><span className="fat-forma">{ehCartao(forma) ? <CreditCard size={16} /> : <Receipt size={16} />} {forma}</span></td>
                      <td className="muted">{f.referencia}</td>
                      <td className="num">{brl(Number(f.valor))}</td>
                      <td>
                        {st === 'paga' && <span className="badge badge--verde"><Check size={13} /> Pago</span>}
                        {st === 'aberta' && <span className="badge badge--amarelo"><Clock size={13} /> Em aberto</span>}
                        {st === 'vencida' && <span className="badge badge--vermelho">Vencida</span>}
                      </td>
                      <td className="num">
                        {st !== 'paga'
                          ? <a className="btn btn--primario btn--sm" href={f.link || pagar} target="_blank" rel="noopener">Pagar <ExternalLink size={14} /></a>
                          : f.link ? <a className="btn btn--contorno btn--sm" href={f.link} target="_blank" rel="noopener">Ver <ExternalLink size={14} /></a> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
