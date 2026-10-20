import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, BadgeCheck, Eye, EyeOff, FileText, Lock, Mail, Phone, ShieldCheck, Store, UserRound } from 'lucide-react';
import { useSessao } from '../lib/sessao';
import { gestao, msgErro, supabase } from '../lib/supabase';
import { SITE } from '../config/site';
import { BotaoAssinar, Campo, Marca } from './Login';
import '../estilos/painel.css';
import '../estilos/login.css';

type Etapa = 'conferir' | 'dados';
interface Compra { nome: string; plano: string; telefone: string; contaExiste: boolean }

/** 000.000.000-00 ou 00.000.000/0000-00 */
function mascaraDocumento(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 14);
  if (d.length <= 11) return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  return d.replace(/(\d{2})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1/$2').replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}
function mascaraTelefone(v: string) {
  const d = v.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}`;
}
const nomePlano = (p: string) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : 'BasilFiery');

/**
 * "Criar meu acesso": depois de pagar na Kirvano, o assinante confere a compra
 * (e-mail + CPF/CNPJ do pagamento) e cria o próprio login e a loja, sem suporte.
 */
export default function Ativar() {
  const s = useSessao();
  const navegar = useNavigate();
  const busca = new URLSearchParams(useLocation().search);
  const [etapa, setEtapa] = useState<Etapa>('conferir');
  const [email, setEmail] = useState(() => busca.get('email') ?? '');
  const [documento, setDocumento] = useState('');
  const [compra, setCompra] = useState<Compra | null>(null);
  const [nome, setNome] = useState('');
  const [loja, setLoja] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [senha, setSenha] = useState('');
  const [senha2, setSenha2] = useState('');
  const [verSenha, setVerSenha] = useState(false);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function conferir(e: FormEvent) {
    e.preventDefault();
    setErro('');
    setOcupado(true);
    try {
      const c = await gestao<Compra>('assinatura_verificar', { email, documento });
      setCompra(c);
      setNome((v) => v || c.nome);
      setWhatsapp((v) => v || mascaraTelefone(c.telefone));
      setEtapa('dados');
    } catch (er) { setErro(msgErro(er)); }
    setOcupado(false);
  }

  async function criar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    if (!compra) return;
    if (!compra.contaExiste && senha !== senha2) return setErro('As senhas não são iguais.');
    setOcupado(true);
    const dados = { email, documento, nome, restaurante: loja, whatsapp, senha };
    try {
      if (compra.contaExiste) {
        // O e-mail já tem login: entra com a senha dele e liga a assinatura a essa conta
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha });
        if (error) throw error;
        await gestao('assinatura_ativar', dados);
      } else {
        await gestao('assinatura_ativar', dados);
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha });
        if (error) throw error;
      }
      await s.recarregar();
      navegar('/painel', { replace: true });
    } catch (er) {
      const m = msgErro(er);
      if (m === 'conta_existente') {
        setCompra({ ...compra, contaExiste: true });
        setErro('Este e-mail já tem uma conta. Digite a senha dela para continuar.');
      } else setErro(m);
      setOcupado(false);
    }
  }

  const docOk = [11, 14].includes(documento.replace(/\D/g, '').length);

  return (
    <div className="lg">
      <div className="lg-fundo" aria-hidden="true">
        <svg className="lg-curvas" viewBox="0 0 1600 900" preserveAspectRatio="none">
          <path d="M700 -20 C 760 140, 860 230, 1010 250" />
          <path d="M1390 250 C 1500 300, 1570 380, 1620 520" />
        </svg>
      </div>

      <section className="lg-hero">
        <Marca />
        <h1>Pagamento feito?<br /><em>Seu acesso sai agora.</em></h1>
        <p>Confirme a compra, crie seu login e comece a montar o cardápio. Leva menos de um minuto.</p>
        <ol className="at-passos">
          <li className={etapa === 'conferir' ? 'ativo' : 'feito'}><span>1</span><div><b>Confirme o pagamento</b><small>E-mail e CPF/CNPJ usados na compra</small></div></li>
          <li className={etapa === 'dados' ? 'ativo' : ''}><span>2</span><div><b>Crie seu login</b><small>Seu nome, o nome da loja e uma senha</small></div></li>
          <li><span>3</span><div><b>Comece a usar</b><small>Painel, cardápio digital e mesas prontos</small></div></li>
        </ol>
      </section>

      {etapa === 'conferir' ? (
        <form className="lg-cartao" onSubmit={conferir}>
          <Marca pequena />
          <h2>Criar meu acesso</h2>
          <p className="lg-cartao__sub">Use os mesmos dados que você informou no pagamento da assinatura.</p>
          <div className="lg-campos">
            <Campo rotulo="E-mail da compra" icone={<Mail size={18} />}>
              <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="seu@email.com" autoFocus />
            </Campo>
            <Campo rotulo="CPF ou CNPJ da compra" icone={<FileText size={18} />}>
              <input inputMode="numeric" required value={documento} onChange={(e) => setDocumento(mascaraDocumento(e.target.value))} placeholder="000.000.000-00" />
            </Campo>
          </div>
          {erro && <p className="lg-erro">{erro}</p>}
          <button className="lg-botao" disabled={ocupado || !email.includes('@') || !docOk}>
            {ocupado ? 'Conferindo…' : <>Conferir pagamento <ArrowRight size={19} /></>}
          </button>
          <div className="lg-ou"><span>ou</span></div>
          <div className="lg-assinar">
            <span className="lg-assinar__icone"><Store size={20} /></span>
            <div>
              <strong>Ainda não assinou?</strong>
              <small>Escolha o plano e volte aqui depois do pagamento.</small>
            </div>
            <BotaoAssinar />
          </div>
          <div className="lg-ajuda">
            <p>Já tem login? <Link className="lg-link" to="/login">Entrar</Link></p>
          </div>
          <footer className="lg-seguro"><ShieldCheck size={16} /> {SITE.marca} • Acesso seguro e protegido</footer>
        </form>
      ) : (
        <form className="lg-cartao" onSubmit={criar}>
          <Marca pequena />
          <span className="at-confirmado"><BadgeCheck size={18} /> Pagamento confirmado · Plano {nomePlano(compra?.plano ?? '')}</span>
          <h2>{compra?.contaExiste ? 'Entre para ativar' : 'Crie seu login'}</h2>
          <p className="lg-cartao__sub">
            {compra?.contaExiste
              ? <>O e-mail <b>{email}</b> já tem uma conta. Digite a senha dela e a assinatura fica ligada a ela.</>
              : <>Você vai entrar com <b>{email}</b> e a senha que criar aqui.</>}
          </p>
          <div className="lg-campos">
            <Campo rotulo="Seu nome" icone={<UserRound size={18} />}>
              <input required autoComplete="name" maxLength={80} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Como você se chama" />
            </Campo>
            <Campo rotulo="Nome do estabelecimento" icone={<Store size={18} />}>
              <input required autoComplete="organization" maxLength={80} value={loja} onChange={(e) => setLoja(e.target.value)} placeholder="Ex.: Pizzaria do Bairro" autoFocus />
            </Campo>
            <Campo rotulo="WhatsApp" icone={<Phone size={18} />}>
              <input inputMode="tel" autoComplete="tel" value={whatsapp} onChange={(e) => setWhatsapp(mascaraTelefone(e.target.value))} placeholder="(00) 00000-0000" />
            </Campo>
            <Campo rotulo={compra?.contaExiste ? 'Senha da sua conta' : 'Crie uma senha'} icone={<Lock size={18} />}
              fim={<button type="button" className="lg-campo__olho" onClick={() => setVerSenha((v) => !v)} aria-label={verSenha ? 'Esconder senha' : 'Ver senha'}>{verSenha ? <EyeOff size={19} /> : <Eye size={19} />}</button>}>
              <input type={verSenha ? 'text' : 'password'} required minLength={6} autoComplete={compra?.contaExiste ? 'current-password' : 'new-password'}
                value={senha} onChange={(e) => setSenha(e.target.value)} placeholder={compra?.contaExiste ? 'Sua senha' : 'Mínimo 6 caracteres'} />
            </Campo>
            {!compra?.contaExiste && (
              <Campo rotulo="Repita a senha" icone={<Lock size={18} />}>
                <input type={verSenha ? 'text' : 'password'} required minLength={6} autoComplete="new-password" value={senha2} onChange={(e) => setSenha2(e.target.value)} placeholder="Digite a mesma senha" />
              </Campo>
            )}
          </div>
          {erro && <p className="lg-erro">{erro}</p>}
          <button className="lg-botao" disabled={ocupado || senha.length < 6}>
            {ocupado ? 'Criando seu acesso…' : <>{compra?.contaExiste ? 'Entrar e ativar' : 'Criar acesso e entrar'} <ArrowRight size={19} /></>}
          </button>
          <button type="button" className="lg-voltar" onClick={() => { setEtapa('conferir'); setErro(''); }}>Voltar</button>
          {compra?.contaExiste && <div className="lg-ajuda"><p>Esqueceu a senha? <Link className="lg-link" to={`/login?email=${encodeURIComponent(email)}`}>Recuperar pelo login</Link></p></div>}
          <nav className="lg-legal"><a href="/termos" target="_blank" rel="noopener">Termos de uso</a><span>·</span><a href="/privacidade" target="_blank" rel="noopener">Política de privacidade</a></nav>
        </form>
      )}
    </div>
  );
}
