/* Conta do candidato: autenticação e dados persistidos no Supabase.
   Configuração em config.js (gerado por `python -m app.build_site` a partir do .env).
   Sem configuração, `Conta.ativa` é false e o portal usa o modo local (localStorage). */
window.Conta = (function () {
  'use strict';

  var cfg = window.PORTAL_CONFIG || {};
  var ativa = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase && window.supabase.createClient);
  var sb = ativa
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      })
    : null;
  var usuario = null;
  var ouvintes = [];

  function avisar() { ouvintes.forEach(function (f) { try { f(usuario); } catch (e) { console.error(e); } }); }
  function exigirUsuario() { if (!usuario) throw new Error('É preciso entrar na conta.'); }
  function checar(r) { if (r.error) throw r.error; return r.data; }

  // Volta para a mesma página, sem hash (o hash é da navegação interna) e sem ?code.
  function urlRetorno() { return location.origin + location.pathname; }

  return {
    ativa: ativa,
    provedores: (cfg.provedores || []).filter(Boolean),
    usuario: function () { return usuario; },
    aoMudar: function (f) { ouvintes.push(f); },

    iniciar: async function () {
      if (!sb) return null;
      // Com PKCE o link do e-mail volta com ?code=...; o supabase-js troca pelo token sozinho.
      var sessao = checar(await sb.auth.getSession()).session;
      usuario = sessao ? sessao.user : null;
      if (/[?&]code=/.test(location.search)) history.replaceState(null, '', urlRetorno() + location.hash);
      sb.auth.onAuthStateChange(function (_evento, s) {
        var novo = s ? s.user : null;
        if ((novo && novo.id) !== (usuario && usuario.id)) { usuario = novo; avisar(); }
      });
      return usuario;
    },

    entrarComEmail: async function (email) {
      checar(await sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: urlRetorno() } }));
    },
    entrarCom: async function (provedor) {
      checar(await sb.auth.signInWithOAuth({ provider: provedor, options: { redirectTo: urlRetorno() } }));
    },
    sair: async function () { checar(await sb.auth.signOut()); },

    // ---- vagas salvas
    listarSalvas: async function () {
      exigirUsuario();
      var linhas = checar(await sb.from('vagas_salvas').select('vaga_id, titulo, empresa, url, salva_em').order('salva_em', { ascending: false }));
      return linhas.map(function (l) {
        return { id: l.vaga_id, titulo: l.titulo, empresa: l.empresa, url: l.url, salva_em: Date.parse(l.salva_em) };
      });
    },
    salvar: async function (itens) {
      exigirUsuario();
      var linhas = [].concat(itens).map(function (i) {
        return { user_id: usuario.id, vaga_id: i.id, titulo: i.titulo || null, empresa: i.empresa || null, url: i.url || null };
      });
      checar(await sb.from('vagas_salvas').upsert(linhas, { onConflict: 'user_id,vaga_id', ignoreDuplicates: true }));
    },
    remover: async function (vagaId) {
      exigirUsuario();
      checar(await sb.from('vagas_salvas').delete().eq('vaga_id', vagaId));
    },

    // ---- perfil
    carregarPerfil: async function () {
      exigirUsuario();
      return checar(await sb.from('perfis').select('nome, habilidades, area, senioridade').eq('id', usuario.id).maybeSingle()) || {};
    },
    gravarPerfil: async function (p) {
      exigirUsuario();
      checar(await sb.from('perfis').upsert({
        id: usuario.id, nome: p.nome || null, habilidades: p.habilidades || [],
        area: p.area || null, senioridade: p.senioridade || null, atualizado_em: new Date().toISOString()
      }));
    },

    // ---- relato de erro numa vaga (não exige login; o banco preenche user_id quando houver)
    reportar: async function (r) {
      checar(await sb.from('reportes_vaga').insert({
        vaga_id: r.vagaId, titulo: r.titulo || null, empresa: r.empresa || null, url: r.url || null,
        tipo: r.tipo, stacks: (r.stacks || []).slice(0, 30), detalhe: (r.detalhe || '').slice(0, 500) || null
      }));
    },

    // ---- LGPD: apaga conta, perfil e vagas salvas
    excluirConta: async function () {
      exigirUsuario();
      checar(await sb.rpc('excluir_minha_conta'));
      await sb.auth.signOut().catch(function () {});
      usuario = null;
      avisar();
    }
  };
})();
