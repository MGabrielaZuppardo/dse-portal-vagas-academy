/* Portal de Vagas em Dados — busca, detalhe da vaga e perfil de competências.
   Tudo roda no navegador sobre window.DADOS (gerado por `python -m app.build_site`). */
(function () {
  'use strict';

  var D = window.DADOS || { vagas: [], skills: {}, sinonimos: {}, coletada_em: null };

  var NIVEIS = [
    ['entrada', 'Entrada'], ['junior', 'Júnior'], ['pleno', 'Pleno'],
    ['senior', 'Sênior'], ['especialista', 'Especialista'], ['gestao', 'Gestão']
  ];
  var NOME_NIVEL = { nao_identificada: 'Não identificada' };
  NIVEIS.forEach(function (n) { NOME_NIVEL[n[0]] = n[1]; });
  var AREAS = {
    engenharia_dados: 'Engenharia de Dados', analise_dados: 'Análise de Dados',
    ciencia_dados: 'Ciência de Dados', ml_engineering: 'Machine Learning',
    analytics_engineering: 'Analytics Engineering', bi: 'BI',
    governanca_dados: 'Governança de Dados', dba: 'Banco de Dados (DBA)', gestao_dados: 'Gestão de Dados',
    negocio_com_dados: 'Negócios com foco em dados'
  };
  // Funções de negócio que usam dados: aparecem na busca, mas não entram nos rankings de "todas as áreas".
  var NEGOCIO = 'negocio_com_dados';
  function contaNoMercado(v, area) { return area ? v.area === area : v.area !== NEGOCIO; }
  var MODELOS = { remoto: 'Remoto', hibrido: 'Híbrido', presencial: 'Presencial' };
  var CONTRATOS = {
    clt: 'CLT', pj: 'PJ', estagio: 'Estágio', trainee: 'Trainee', aprendiz: 'Aprendiz',
    temporario: 'Temporário', cooperado: 'Cooperado', autonomo: 'Autônomo',
    terceirizado: 'Terceirizado', banco_talentos: 'Banco de talentos', outro: 'Outro'
  };
  var POR_PAGINA = 20;

  var ICONE_BUSCA = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4A5874" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg>';
  var ICONE_SALVAR = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z"></path></svg>';
  var ICONE_ESTRELA = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#8EC5FF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.2 5.3L20 9l-4.4 3.8L17 19l-5-3-5 3 1.4-6.2L4 9l5.8-.7z"></path></svg>';
  var ICONE_EXTERNO = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"></path></svg>';
  var ICONE_SETA = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"></path></svg>';
  var ICONE_OK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-label="você já sabe"><path d="M5 12l5 5 9-10"></path></svg>';

  // ---------------------------------------------------------------- utilidades

  function norm(s) { return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
  // Mesma regra de enrichment/taxonomia.py::chave_skill
  function chaveSkill(s) { return norm(s).replace(/\s+/g, ' ').trim().replace(/[\s\-_.]/g, ''); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function nomeSkill(id) { return D.skills[id] || id; }
  function sigla(empresa) {
    var p = (empresa || '?').replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
    return ((p[0] || '?')[0] + (p[1] ? p[1][0] : (p[0] || '')[1] || '')).toUpperCase();
  }
  function local(v) {
    if (v.cidade && v.uf) return v.cidade + ', ' + v.uf;
    return v.uf || v.cidade || (v.modelo === 'remoto' ? 'Brasil' : 'Local não informado');
  }
  function quando(v) {
    var dias = Math.max(0, Math.floor((Date.now() - v._ts) / 864e5));
    if (dias === 0) return 'hoje';
    if (dias === 1) return 'há 1 dia';
    if (dias < 14) return 'há ' + dias + ' dias';
    if (dias < 60) return 'há ' + Math.floor(dias / 7) + ' semanas';
    return 'há ' + Math.floor(dias / 30) + ' meses';
  }
  function dataHora(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  }
  function reais(n) { return n == null ? null : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }); }
  function contar(lista, chave) {
    var c = {};
    lista.forEach(function (x) { (chave(x) || []).forEach(function (k) { c[k] = (c[k] || 0) + 1; }); });
    return Object.keys(c).map(function (k) { return [k, c[k]]; }).sort(function (a, b) { return b[1] - a[1] || a[0].localeCompare(b[0]); });
  }

  var Conta = window.Conta || { ativa: false, provedores: [], usuario: function () { return null; }, aoMudar: function () {} };

  // Vagas salvas do candidato. Com a conta configurada (Supabase), ficam na conta da pessoa
  // e exigem login; sem ela (ambiente local), ficam no localStorage deste navegador.
  // Guarda um resumo da vaga para ela continuar listada mesmo depois de sair da coleta.
  var salvas = (function () {
    var CHAVE = 'portal-vagas:salvas', itens = {};
    function lerLocal() {
      var r = {};
      try {
        var lido = JSON.parse(localStorage.getItem(CHAVE));
        if (Array.isArray(lido)) lido.forEach(function (id) { r[id] = { id: id, salva_em: Date.now() }; }); // formato antigo
        else if (lido && typeof lido === 'object') r = lido;
      } catch (e) { /* sem storage */ }
      return r;
    }
    function gravarLocal() {
      try { localStorage.setItem(CHAVE, JSON.stringify(itens)); } catch (e) { /* sem storage: vale só nesta aba */ }
    }
    function resumo(id) {
      var v = POR_ID[id] || {};
      return { id: id, titulo: v.titulo, empresa: v.empresa, url: v.url, salva_em: Date.now() };
    }
    if (!Conta.ativa) itens = lerLocal();

    return {
      tem: function (id) { return !!itens[id]; },
      listar: function () {
        return Object.keys(itens).map(function (k) { return itens[k]; }).sort(function (a, b) { return b.salva_em - a.salva_em; });
      },
      total: function () { return Object.keys(itens).length; },
      // Após o login: sobe o que estava salvo localmente e carrega a lista da conta.
      carregar: async function () {
        var locais = lerLocal(), pendentes = Object.keys(locais).map(function (k) { return locais[k]; });
        if (pendentes.length) {
          await Conta.salvar(pendentes);
          try { localStorage.removeItem(CHAVE); } catch (e) { /* ok */ }
        }
        itens = {};
        (await Conta.listarSalvas()).forEach(function (i) { itens[i.id] = i; });
      },
      esquecer: function () { itens = {}; },
      // Atualiza na hora (otimista) e desfaz se o servidor recusar.
      alternar: async function (id) {
        var antigo = itens[id];
        if (antigo) delete itens[id]; else itens[id] = resumo(id);
        if (!Conta.ativa) { gravarLocal(); return !antigo; }
        try {
          if (antigo) await Conta.remover(id); else await Conta.salvar(itens[id]);
        } catch (e) {
          if (antigo) itens[id] = antigo; else delete itens[id];
          throw e;
        }
        return !antigo;
      }
    };
  })();

  var perfilConta = null; // { nome, habilidades, area, senioridade } da pessoa logada

  // Intenções que precisam sobreviver ao vaivém do login (o link do e-mail pode abrir outra aba).
  var intencao = {
    CHAVE: 'portal-vagas:apos-login',
    guardar: function (dados) { try { localStorage.setItem(this.CHAVE, JSON.stringify({ t: Date.now(), d: dados })); } catch (e) { /* ok */ } },
    retirar: function () {
      try {
        var x = JSON.parse(localStorage.getItem(this.CHAVE));
        localStorage.removeItem(this.CHAVE);
        return x && Date.now() - x.t < 3600e3 ? x.d : null; // vale por 1 hora
      } catch (e) { return null; }
    }
  };

  function aviso(msg) {
    var el = document.querySelector('[data-aviso]');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(aviso._t);
    aviso._t = setTimeout(function () { el.hidden = true; }, 5000);
  }

  function atualizarContador() {
    var n = salvas.total(), el = document.querySelector('[data-contador-salvas]');
    if (el) {
      el.hidden = !n;
      el.textContent = n;
      el.setAttribute('aria-label', n + (n === 1 ? ' vaga salva' : ' vagas salvas'));
    }
    var entrar = document.querySelector('[data-link-entrar]');
    if (entrar) entrar.hidden = !Conta.ativa || !!Conta.usuario();
  }

  // ---------------------------------------------------------------- dados

  D.vagas.forEach(function (v) {
    v._ts = Date.parse(v.publicada_em) || 0;
    v._titulo = norm(v.titulo);
    // Até as descrições chegarem (descricoes.js), a busca cobre título, empresa e nomes das stacks.
    var nomesStacks = (v.citadas || []).concat(v.obrigatorias || [], v.desejaveis || []).map(nomeSkill).join(' ');
    v._texto = norm(v.titulo + ' ' + v.empresa + ' ' + nomesStacks);
    // Stacks da vaga: as do LLM quando ela foi enriquecida; senão, as citadas (palavra-chave).
    v._principais = v.enriquecida ? (v.obrigatorias || []) : (v.citadas || []);
    v._stacks = v.enriquecida ? (v.obrigatorias || []).concat(v.desejaveis || []) : (v.citadas || []);
  });
  // Descrições em arquivo separado (~85% do volume): carregadas em segundo plano depois da
  // primeira renderização, ou na hora quando a pessoa abre uma vaga. Script (não fetch) para
  // funcionar também abrindo o HTML direto do disco.
  var descricoes = (function () {
    var estado = 'pendente', espera = [];
    function avisarTodos(ok) { var fila = espera; espera = []; fila.forEach(function (f) { f(ok); }); }
    return {
      prontas: function () { return estado === 'ok'; },
      falharam: function () { return estado === 'erro'; },
      de: function (id) { return estado === 'ok' ? (window.DESCRICOES || {})[id] || '' : null; },
      carregar: function (cb) {
        if (cb) { if (estado === 'ok' || estado === 'erro') { cb(estado === 'ok'); return; } espera.push(cb); }
        if (estado !== 'pendente') return;
        estado = 'carregando';
        var script = document.createElement('script');
        script.src = 'descricoes.js';
        script.async = true;
        script.onload = function () {
          var todas = window.DESCRICOES || {};
          D.vagas.forEach(function (v) { if (todas[v.id]) v._texto += ' ' + norm(todas[v.id]); });
          estado = 'ok';
          avisarTodos(true);
        };
        script.onerror = function () { estado = 'erro'; avisarTodos(false); };
        document.head.appendChild(script);
      }
    };
  })();

  // Banco de talentos não é vaga aberta; "fora do escopo" é ruído da busca por "dados".
  // A coleta é semanal: vagas com prazo de candidatura vencido somem sem esperar a próxima.
  var HOJE = new Date().toLocaleDateString('sv-SE'); // AAAA-MM-DD no fuso de quem acessa
  var VISIVEIS = D.vagas.filter(function (v) {
    return v.contrato !== 'banco_talentos' && v.area !== 'fora_do_escopo' && !(v.prazo && v.prazo < HOJE);
  });
  var POR_ID = {};
  D.vagas.forEach(function (v) { POR_ID[v.id] = v; });
  var TOP_STACKS = contar(VISIVEIS, function (v) { return v._stacks; }).slice(0, 12).map(function (x) { return x[0]; });
  var EMPRESAS = contar(VISIVEIS, function (v) { return [v.empresa]; }).sort(function (a, b) { return a[0].localeCompare(b[0], 'pt-BR'); });
  var AREAS_PRESENTES = contar(VISIVEIS, function (v) { return v.area ? [v.area] : []; });
  var COM_STACKS = VISIVEIS.filter(function (v) { return v._stacks.length; }).length;

  // ---------------------------------------------------------------- estado

  var BUSCA_INICIAL = { q: '', sen: null, stacks: [], empresa: '', modelos: [], negocio: true, ordem: 'recentes', limite: POR_PAGINA };
  var busca = Object.assign({}, BUSCA_INICIAL);
  var perfil = { area: '', sen: null, sei: '' };
  var raiz = document.getElementById('conteudo');

  function filtrarBusca() {
    var termos = norm(busca.q).split(/\s+/).filter(Boolean);
    var r = VISIVEIS.filter(function (v) {
      if (busca.sen && v.senioridade !== busca.sen) return false;
      if (busca.empresa && v.empresa !== busca.empresa) return false;
      if (busca.modelos.length && busca.modelos.indexOf(v.modelo) < 0) return false;
      if (!busca.negocio && v.area === NEGOCIO) return false;
      for (var i = 0; i < busca.stacks.length; i++) if (v._stacks.indexOf(busca.stacks[i]) < 0) return false;
      for (var j = 0; j < termos.length; j++) if (v._texto.indexOf(termos[j]) < 0) return false;
      return true;
    });
    var relev = function (v) { return termos.filter(function (t) { return v._titulo.indexOf(t) >= 0; }).length; };
    var ordem = ordemEfetiva();
    var conhecidas = ordem === 'aderentes' ? idsDasHabilidades(habilidadesAtuais()).ids : null;
    if (conhecidas) r.forEach(function (v) { v._aderencia = aderencia(v, conhecidas); });
    r.sort(function (a, b) {
      var d = 0;
      if (ordem === 'relevantes') d = relev(b) - relev(a);
      else if (ordem === 'aderentes') d = (b._aderencia.nota - a._aderencia.nota) || (b._aderencia.tem - a._aderencia.tem);
      return d || b._ts - a._ts;
    });
    return r;
  }

  // "relevantes" só faz sentido com texto na busca; "aderentes" precisa de habilidades informadas.
  function ordemEfetiva() {
    if (busca.ordem === 'relevantes' && !norm(busca.q).trim()) return 'recentes';
    if (busca.ordem === 'aderentes' && !Object.keys(idsDasHabilidades(habilidadesAtuais()).ids).length) return 'recentes';
    return busca.ordem;
  }

  // % das stacks da vaga que a pessoa já tem (exibido) e uma nota suavizada para ordenar:
  // tem / (total + 2) evita que "1 de 1" (100%) passe à frente de "6 de 8" (75%), que diz muito mais.
  // Vagas sem stacks identificadas ficam no fim.
  var SUAVIZACAO_ADERENCIA = 2;
  function aderencia(v, conhecidas) {
    var stacks = v._principais.length ? v._principais : v._stacks;
    var tem = stacks.filter(function (id) { return conhecidas[id]; }).length;
    return {
      tem: tem, total: stacks.length,
      pct: stacks.length ? Math.round(100 * tem / stacks.length) : -1,
      nota: stacks.length ? tem / (stacks.length + SUAVIZACAO_ADERENCIA) : -1
    };
  }

  function filtrosAtivos() {
    return (busca.sen ? 1 : 0) + busca.stacks.length + (busca.empresa ? 1 : 0) + busca.modelos.length + (busca.negocio ? 0 : 1);
  }

  // ---------------------------------------------------------------- busca

  function htmlBusca() {
    var niveis = [[null, 'Todas']].concat(NIVEIS).map(function (n) {
      return '<button type="button" class="pilula" data-sen="' + (n[0] || '') + '" aria-pressed="' + (busca.sen === n[0]) + '">' + n[1] + '</button>';
    }).join('');
    var stacks = TOP_STACKS.length
      ? '<div class="opcoes">' + TOP_STACKS.map(function (id) {
          return '<button type="button" class="chip-botao" data-stack="' + esc(id) + '" aria-pressed="' + (busca.stacks.indexOf(id) >= 0) + '">' + esc(nomeSkill(id)) + '</button>';
        }).join('') + '</div>'
      : '<p class="nota">Nenhuma stack identificada nas vagas desta coleta.</p>';
    var empresas = '<option value="">Todas</option>' + EMPRESAS.map(function (e) {
      return '<option value="' + esc(e[0]) + '"' + (busca.empresa === e[0] ? ' selected' : '') + '>' + esc(e[0]) + ' (' + e[1] + ')</option>';
    }).join('');
    var modelos = Object.keys(MODELOS).map(function (m) {
      return '<label class="caixa"><input type="checkbox" data-modelo="' + m + '"' + (busca.modelos.indexOf(m) >= 0 ? ' checked' : '') + '> ' + MODELOS[m] + '</label>';
    }).join('');
    var abrirFiltros = window.matchMedia('(min-width: 901px)').matches;

    return '' +
      '<section class="hero">' +
        '<svg class="hero-pontos" viewBox="-4 0 68 56" aria-hidden="true"><use href="#pontos"></use></svg>' +
        '<span class="selo">UM PROJETO DSE ACADEMY PARA A COMUNIDADE</span>' +
        '<div class="hero-textos">' +
          '<h1>Vagas de dados, num só lugar.</h1>' +
          '<p>Engenharia, análise, ciência e ML reunidas das páginas de carreira das empresas na Gupy, com senioridade e stacks extraídas automaticamente.</p>' +
        '</div>' +
        '<form class="busca" role="search" data-acao="buscar">' +
          '<label class="busca-campo" for="busca">' + ICONE_BUSCA +
            '<span class="sr">Buscar vagas</span>' +
            '<input id="busca" type="search" autocomplete="off" placeholder="Cargo, empresa ou tecnologia — ex.: engenheira de dados, dbt" value="' + esc(busca.q) + '">' +
          '</label>' +
          '<button class="botao-busca" type="submit">Buscar</button>' +
        '</form>' +
      '</section>' +
      '<div class="pagina-busca">' +
        '<details class="filtros"' + (abrirFiltros ? ' open' : '') + '>' +
          '<summary><span>Filtros <span class="contagem" data-contagem></span></span>' + ICONE_SETA + '</summary>' +
          '<div class="filtros-corpo">' +
            '<div class="filtros-topo"><h2>Filtros</h2><button type="button" class="link-botao" data-acao="limpar">Limpar</button></div>' +
            '<fieldset><legend class="rotulo">Senioridade</legend><div class="opcoes">' + niveis + '</div></fieldset>' +
            '<fieldset><legend class="rotulo">Stacks</legend>' + stacks + '</fieldset>' +
            '<div class="grupo"><label class="rotulo" for="empresa">Empresa</label><select id="empresa" class="seletor">' + empresas + '</select></div>' +
            '<fieldset><legend class="rotulo">Modelo de trabalho</legend>' + modelos + '</fieldset>' +
            '<fieldset><legend class="rotulo">Tipo de vaga</legend>' +
              '<label class="caixa"><input type="checkbox" data-negocio' + (busca.negocio ? ' checked' : '') + '> Incluir funções de negócio com foco em dados</label>' +
              '<span class="nota">Ex.: comercial, RH ou operações que usam dados no dia a dia.</span></fieldset>' +
            '<p class="nota">' + VISIVEIS.length + ' vagas abertas · ' + COM_STACKS + ' com stacks identificadas · coleta de ' + esc(dataHora(D.coletada_em)) + '</p>' +
          '</div>' +
        '</details>' +
        '<section class="resultados" aria-live="polite" aria-busy="false" data-resultados></section>' +
      '</div>';
  }

  function htmlCartao(v, comAderencia) {
    var lista = v._principais.length ? v._principais : v._stacks;
    var stacks = lista.slice(0, 5).map(function (id) {
      return '<span class="etiqueta-stack">' + esc(nomeSkill(id)) + '</span>';
    }).join('') + (lista.length > 5 ? '<span class="etiqueta-neutra">+' + (lista.length - 5) + '</span>' : '');
    var info = [v.empresa, local(v), MODELOS[v.modelo]].filter(Boolean).map(esc).join(' · ');
    var salva = salvas.tem(v.id);
    return '<article class="cartao">' +
      '<div class="sigla" aria-hidden="true">' + esc(sigla(v.empresa)) + '</div>' +
      '<div class="cartao-corpo">' +
        '<div><a class="cartao-titulo" href="#/vaga/' + encodeURIComponent(v.id) + '">' + esc(v.titulo) + '</a></div>' +
        '<span class="cartao-info">' + info + '</span>' +
        '<div class="etiquetas">' +
          (v.senioridade && NOME_NIVEL[v.senioridade] ? '<span class="etiqueta-nivel">' + NOME_NIVEL[v.senioridade] + '</span>' : '') +
          (v.area === NEGOCIO ? '<span class="etiqueta-neutra">' + AREAS[NEGOCIO] + '</span>' : '') +
          stacks +
        '</div>' +
        (comAderencia && v._aderencia && v._aderencia.pct >= 0
          ? '<a class="selo-aderencia" href="#/vaga/' + encodeURIComponent(v.id) + '/aderencia">' +
              '<span class="selo-aderencia-barra" aria-hidden="true"><span style="width:' + v._aderencia.pct + '%"></span></span>' +
              '<strong>' + v._aderencia.pct + '% aderente</strong> · você tem ' + v._aderencia.tem + ' de ' + v._aderencia.total + ' stacks</a>'
          : '') +
      '</div>' +
      '<div class="cartao-lado">' +
        '<span class="quando">' + quando(v) + '</span>' +
        '<span class="fonte">via Gupy</span>' +
        '<button type="button" class="salvar" data-salvar="' + esc(v.id) + '" aria-pressed="' + salva + '" aria-label="Salvar vaga: ' + esc(v.titulo) + '">' + ICONE_SALVAR + '</button>' +
      '</div>' +
    '</article>';
  }

  function renderResultados() {
    var alvo = raiz.querySelector('[data-resultados]');
    if (!alvo) return;
    var r = filtrarBusca();
    var ordem = ordemEfetiva();
    var temTexto = !!norm(busca.q).trim();
    var buscaParcial = temTexto && !descricoes.prontas();
    var alvoPerfil = busca.sen ? 'o nível ' + NOME_NIVEL[busca.sen] : 'vagas de dados';
    var linkPerfil = linkResultadoPerfil({ sen: busca.sen });
    alvo.innerHTML =
      '<div class="resultados-topo">' +
        '<p><strong>' + r.length.toLocaleString('pt-BR') + '</strong> ' + (r.length === 1 ? 'vaga encontrada' : 'vagas encontradas') + '</p>' +
        '<label class="ordenar">Ordenar por <select data-ordem>' +
          '<option value="recentes"' + (busca.ordem === 'recentes' || (busca.ordem === 'relevantes' && !temTexto) ? ' selected' : '') + '>Mais recentes</option>' +
          (temTexto ? '<option value="relevantes"' + (busca.ordem === 'relevantes' ? ' selected' : '') + '>Mais relevantes</option>' : '') +
          '<option value="aderentes"' + (busca.ordem === 'aderentes' ? ' selected' : '') + '>Mais aderentes ao meu perfil</option>' +
        '</select></label>' +
      '</div>' +
      (buscaParcial ? '<p class="nota">Buscando em títulos, empresas e stacks.' +
        (descricoes.falharam() ? '' : ' A busca no texto completo das vagas fica disponível em instantes.') + '</p>' : '') +
      (busca.ordem === 'aderentes' && ordem !== 'aderentes'
        ? '<div class="aviso-inline" role="status"><strong>Informe o que você já sabe para ordenar por aderência.</strong> ' +
            '<form class="aviso-form" data-acao="habilidades-busca"><label class="sr" for="b-sei">Suas habilidades</label>' +
            '<input id="b-sei" class="campo" type="text" autocomplete="off" placeholder="ex.: SQL, Python, Power BI">' +
            '<button type="submit" class="botao-cheio">Ordenar</button></form>' +
            (Conta.usuario && Conta.usuario() ? '<span class="nota">Também dá para salvar suas habilidades em <a href="#/candidato">Meu perfil</a>.</span>' : '') +
          '</div>'
        : '') +
      '<a class="cta-perfil" href="' + linkPerfil + '">' + ICONE_ESTRELA +
        '<span class="cta-textos"><span class="cta-titulo">O que o mercado pede para ' + alvoPerfil + '?</span>' +
        '<span class="cta-sub">Veja as competências mais pedidas nas vagas abertas e o que falta no seu perfil.</span></span>' +
        '<span class="cta-acao">Ver perfil →</span>' +
      '</a>' +
      (r.length
        ? r.slice(0, busca.limite).map(function (v) { return htmlCartao(v, ordem === 'aderentes'); }).join('') +
          (r.length > busca.limite ? '<button type="button" class="mais" data-acao="mais">Mostrar mais ' + Math.min(POR_PAGINA, r.length - busca.limite) + ' de ' + (r.length - busca.limite) + '</button>' : '')
        : '<div class="vazio"><strong>Nenhuma vaga com esses filtros</strong><span>Tente remover uma stack, mudar a senioridade ou buscar outro termo.</span></div>');

    var n = filtrosAtivos();
    var cont = raiz.querySelector('[data-contagem]');
    if (cont) cont.textContent = n ? '(' + n + ' ativo' + (n > 1 ? 's' : '') + ')' : '';
  }

  function sincronizarFiltros() {
    raiz.querySelectorAll('[data-sen]').forEach(function (b) { b.setAttribute('aria-pressed', String((b.dataset.sen || null) === busca.sen)); });
    raiz.querySelectorAll('[data-stack]').forEach(function (b) { b.setAttribute('aria-pressed', String(busca.stacks.indexOf(b.dataset.stack) >= 0)); });
    raiz.querySelectorAll('[data-modelo]').forEach(function (c) { c.checked = busca.modelos.indexOf(c.dataset.modelo) >= 0; });
    var neg = raiz.querySelector('[data-negocio]'); if (neg) neg.checked = busca.negocio;
    var emp = raiz.querySelector('#empresa'); if (emp) emp.value = busca.empresa;
    var q = raiz.querySelector('#busca'); if (q && q.value !== busca.q) q.value = busca.q;
  }

  function atualizarBusca() { busca.limite = POR_PAGINA; sincronizarFiltros(); renderResultados(); }

  // ---------------------------------------------------------------- vaga

  function htmlVaga(v) {
    if (!v) {
      return '<div class="pagina-vaga"><div class="vazio"><strong>Vaga não encontrada</strong>' +
        '<span>Ela pode ter sido encerrada desde a última coleta. <a href="#/">Voltar para as vagas</a></span></div></div>';
    }
    var fato = function (rotulo, valor) { return '<div class="fato"><span>' + rotulo + '</span><span>' + esc(valor) + '</span></div>'; };
    var sal = v.salario ? [reais(v.salario[0]), reais(v.salario[1])].filter(Boolean).join(' a ') : 'Não informado';
    var chips = function (ids, classe) {
      return ids.length ? '<div class="opcoes">' + ids.map(function (id) { return '<span class="' + classe + '">' + esc(nomeSkill(id)) + '</span>'; }).join('') + '</div>'
        : '<p class="nota">Nenhuma identificada.</p>';
    };
    var stacks = v.enriquecida
      ? '<div class="pilha"><span class="rotulo">Obrigatórias</span>' + chips(v.obrigatorias, 'chip-forte') + '</div>' +
        '<div class="pilha"><span class="rotulo">Desejáveis</span>' + chips(v.desejaveis, 'chip-fraco') + '</div>'
      : chips(v.citadas || [], 'chip-forte');
    var tituloStacks = v.enriquecida ? 'Stacks extraídas' : 'Stacks citadas na vaga';
    var notaStacks = v.enriquecida ? 'por IA · revise na fonte' : 'por palavra-chave · revise na fonte';
    var perfilHref = linkResultadoPerfil({ area: v.area, sen: NOME_NIVEL[v.senioridade] ? v.senioridade : null });
    var salva = salvas.tem(v.id);

    return '<div class="pagina-vaga">' +
      '<nav aria-label="Trilha" class="trilha-nav"><a href="#/">Vagas</a><span aria-hidden="true">/</span>' +
        (v.area && AREAS[v.area] ? '<span>' + AREAS[v.area] + '</span><span aria-hidden="true">/</span>' : '') +
        '<span>' + esc(v.empresa) + '</span></nav>' +
      '<div class="vaga-grade">' +
        '<article class="vaga">' +
          '<div class="vaga-cabeca"><div class="sigla" aria-hidden="true">' + esc(sigla(v.empresa)) + '</div>' +
            '<div class="vaga-cabeca-textos"><h1>' + esc(v.titulo) + '</h1>' +
            '<span>' + [v.empresa, local(v), MODELOS[v.modelo], 'publicada ' + quando(v)].filter(Boolean).map(esc).join(' · ') + '</span></div></div>' +
          '<div class="vaga-corpo">' +
            '<div class="fatos">' +
              fato('SENIORIDADE', NOME_NIVEL[v.senioridade] || 'Não identificada') +
              fato('MODELO', MODELOS[v.modelo] || 'Não informado') +
              fato('CONTRATO', CONTRATOS[v.contrato] || 'Não informado') +
              fato('SALÁRIO', sal) +
            '</div>' +
            '<section class="secao"><h2>Sobre a vaga</h2><p class="descricao" data-descricao="' + esc(v.id) + '">' +
              (descricoes.prontas() ? esc(descricoes.de(v.id)) : 'Carregando a descrição…') + '</p></section>' +
            '<div class="acoes">' +
              '<a class="botao-primario" href="' + esc(v.url) + '" target="_blank" rel="noopener">Candidatar-se na Gupy ' + ICONE_EXTERNO + '</a>' +
              '<button type="button" class="botao-secundario" data-salvar="' + esc(v.id) + '" aria-pressed="' + salva + '">' + (salva ? 'Vaga salva' : 'Salvar vaga') + '</button>' +
            '</div>' +
          '</div>' +
        '</article>' +
        '<aside class="vaga-lado">' +
          '<section class="painel"><div class="painel-topo"><h2>' + tituloStacks + '</h2><span class="painel-nota">' + notaStacks + '</span></div>' + stacks +
            '<a class="link-simples" href="' + perfilHref + '">O que o mercado pede em vagas parecidas →</a></section>' +
          '<a class="cta-escuro" href="#/vaga/' + encodeURIComponent(v.id) + '/aderencia"><span class="sobre">ADERÊNCIA À VAGA</span>' +
            '<span class="titulo">Estou pronta(o) para essa vaga?</span>' +
            '<span class="texto">Compare as suas habilidades com as stacks desta vaga e veja o que falta.</span>' +
            '<span class="acao">Ver minha aderência →</span></a>' +
          '<section class="painel"><h2>Onde encontramos</h2>' +
            '<a href="' + esc(v.url) + '" target="_blank" rel="noopener">Gupy · anúncio original</a>' +
            (v.duplicatas ? '<span class="nota">Publicada ' + (v.duplicatas + 1) + ' vezes pela empresa (deduplicada)</span>' : '') +
            '<span class="nota">Última verificação: ' + esc(dataHora(D.coletada_em)) + '</span></section>' +
          htmlReportar(v) +
        '</aside>' +
      '</div>' +
    '</div>';
  }

  // ---------------------------------------------------------------- reportar erro na vaga

  var TIPOS_REPORTE = [
    ['stack_errada', 'Stack identificada errada'],
    ['nao_e_vaga_de_dados', 'Não é uma vaga de dados'],
    ['senioridade_errada', 'Senioridade errada'],
    ['vaga_encerrada', 'A vaga já foi encerrada'],
    ['outro', 'Outro problema']
  ];

  // Lembra neste navegador quais vagas a pessoa já reportou (só conveniência; o envio vai para o banco).
  var reportadas = (function () {
    var CHAVE = 'portal-vagas:reportadas', ids = {};
    try { (JSON.parse(localStorage.getItem(CHAVE)) || []).forEach(function (id) { ids[id] = true; }); } catch (e) { /* sem storage */ }
    return {
      tem: function (id) { return !!ids[id]; },
      marcar: function (id) {
        ids[id] = true;
        try { localStorage.setItem(CHAVE, JSON.stringify(Object.keys(ids).slice(-200))); } catch (e) { /* ok */ }
      }
    };
  })();

  function htmlReportar(v) {
    if (!Conta.ativa || !Conta.reportar) return ''; // sem Supabase não há para onde enviar
    if (reportadas.tem(v.id)) {
      return '<section class="painel reportar"><h2 class="painel-titulo">Algo errado nesta vaga?</h2>' +
        '<p class="nota">Você já enviou um relato sobre esta vaga. Obrigado por ajudar a melhorar o portal!</p></section>';
    }
    var stacks = v._stacks.map(function (id) {
      return '<label class="caixa"><input type="checkbox" name="rep-stack" value="' + esc(id) + '"> ' + esc(nomeSkill(id)) + '</label>';
    }).join('');
    var logado = !!(Conta.usuario && Conta.usuario());
    return '<section class="painel reportar">' +
      '<details data-reportar><summary><h2 class="painel-titulo">Algo errado nesta vaga?</h2></summary>' +
        '<form class="pilha" data-acao="reportar" data-vaga="' + esc(v.id) + '">' +
          '<fieldset><legend class="rotulo">O que está errado?</legend>' +
            TIPOS_REPORTE.map(function (t, i) {
              return '<label class="caixa"><input type="radio" name="rep-tipo" value="' + t[0] + '"' + (i === 0 ? ' required' : '') + '> ' + t[1] + '</label>';
            }).join('') +
          '</fieldset>' +
          (stacks ? '<fieldset data-rep-stacks hidden><legend class="rotulo">Quais stacks estão erradas?</legend><div class="rep-stacks">' + stacks + '</div></fieldset>' : '') +
          '<label class="rotulo" for="rep-detalhe">Detalhes (opcional)</label>' +
          '<textarea id="rep-detalhe" class="campo campo-texto" maxlength="500" rows="3" placeholder="Ex.: a vaga pede Spark, não Snowflake"></textarea>' +
          '<button type="submit" class="botao-cheio">Enviar relato</button>' +
          '<p class="nota">Não precisa entrar na conta.' + (logado ? ' Como você está conectada(o), o relato fica ligado à sua conta.' : ' O relato é anônimo.') + '</p>' +
        '</form>' +
      '</details>' +
      '<div class="nota" role="status" data-reportar-status></div>' +
    '</section>';
  }

  function enviarRelato(form) {
    var v = POR_ID[form.dataset.vaga];
    var tipo = (form.querySelector('input[name=rep-tipo]:checked') || {}).value;
    var status = raiz.querySelector('[data-reportar-status]');
    if (!v || !tipo) return;
    var stacks = tipo === 'stack_errada'
      ? [].map.call(form.querySelectorAll('input[name=rep-stack]:checked'), function (c) { return nomeSkill(c.value); })
      : [];
    var botao = form.querySelector('button[type=submit]');
    botao.disabled = true;
    status.textContent = 'Enviando…';
    Conta.reportar({
      vagaId: v.id, titulo: v.titulo, empresa: v.empresa, url: v.url, tipo: tipo,
      stacks: stacks, detalhe: form.querySelector('#rep-detalhe').value.trim()
    }).then(function () {
      reportadas.marcar(v.id);
      var det = raiz.querySelector('[data-reportar]');
      if (det) det.remove();
      status.textContent = 'Relato enviado. Obrigado por ajudar a melhorar o portal!';
    }).catch(function (err) {
      console.error(err);
      botao.disabled = false;
      status.textContent = 'Não foi possível enviar agora. Tente de novo em instantes.';
    });
  }

  // ---------------------------------------------------------------- perfil

  function htmlPerfil() {
    var areas = '<option value="">Todas as áreas</option>' + AREAS_PRESENTES.map(function (a) {
      return '<option value="' + a[0] + '"' + (perfil.area === a[0] ? ' selected' : '') + '>' + esc(AREAS[a[0]] || a[0]) + '</option>';
    }).join('');
    var niveis = [[null, 'Todos']].concat(NIVEIS).map(function (n) {
      return '<button type="button" class="pilula" data-psen="' + (n[0] || '') + '" aria-pressed="' + (perfil.sen === n[0]) + '">' + n[1] + '</button>';
    }).join('');
    return '<div class="pagina-perfil-form">' +
      '<div class="perfil-intro"><span class="sobretitulo">PERFIL DE COMPETÊNCIAS</span>' +
        '<h1>O que o mercado pede para a sua próxima vaga</h1>' +
        '<p>Contamos as stacks citadas nas vagas abertas da área e do nível que você escolher e mostramos o que falta no seu perfil.</p></div>' +
      '<form class="formulario" data-acao="perfil">' +
        '<div class="grupo"><label class="rotulo" for="funcao">Função</label><select id="funcao" class="seletor">' + areas + '</select></div>' +
        '<fieldset><legend class="rotulo">Senioridade</legend><div class="niveis">' + niveis + '</div></fieldset>' +
        '<div class="grupo"><label class="rotulo" for="sei">O que eu já sei (opcional)</label>' +
          '<input id="sei" class="campo" type="text" autocomplete="off" placeholder="ex.: SQL, Python, Power BI" value="' + esc(perfil.sei) + '"></div>' +
        '<button type="submit" class="botao-cheio">Gerar perfil</button>' +
      '</form>' +
    '</div>';
  }

  // Tela de resultado: filtros e habilidades vão no endereço, então Voltar e compartilhar funcionam.
  function linkResultadoPerfil(o) {
    var q = [];
    if (o.area && AREAS[o.area]) q.push('area=' + o.area);
    if (o.sen && NOME_NIVEL[o.sen]) q.push('sen=' + o.sen);
    if (o.sei) q.push('sei=' + encodeURIComponent(o.sei));
    return '#/perfil/resultado' + (q.length ? '?' + q.join('&') : '');
  }

  function htmlPerfilResultado() {
    var editar = '#/perfil?' + ['area=' + (perfil.area || ''), 'sen=' + (perfil.sen || '')].join('&');
    return '<div class="pagina-perfil-resultado">' +
      '<a class="voltar" href="' + editar + '">← Alterar filtros</a>' +
      '<section class="resultado" aria-live="polite" data-perfil></section>' +
    '</div>';
  }

  function renderPerfil() {
    var alvo = raiz.querySelector('[data-perfil]');
    if (!alvo) return;
    var pool = VISIVEIS.filter(function (v) {
      return v._stacks.length && contaNoMercado(v, perfil.area) && (!perfil.sen || v.senioridade === perfil.sen);
    });
    var titulo = (AREAS[perfil.area] || 'Todas as áreas') + ' · ' + (perfil.sen ? NOME_NIVEL[perfil.sen] : 'Todos os níveis');
    var n = pool.length;

    if (!n) {
      alvo.innerHTML = '<div class="resultado-topo"><h2>' + esc(titulo) + '</h2></div>' +
        '<div class="resultado-grade"><div class="vazio" style="grid-column: 1 / -1"><strong>Nenhuma vaga aberta para esse filtro</strong>' +
        '<span>Escolha outra área ou nível.</span></div></div>';
      return;
    }

    var seiIds = {}, naoReconhecidas = [];
    perfil.sei.split(/[,;\n]/).map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (s) {
      var id = D.sinonimos[chaveSkill(s)];
      if (id) seiIds[id] = true; else naoReconhecidas.push(s);
    });
    var informou = Object.keys(seiIds).length > 0;

    var essenciais = contar(pool, function (v) { return v._principais; }).slice(0, 8);
    var idsEss = essenciais.map(function (e) { return e[0]; });
    var diferenciais = contar(pool, function (v) { return v.desejaveis; })
      .filter(function (d) { return idsEss.indexOf(d[0]) < 0; }).slice(0, 6);
    var falta = essenciais.filter(function (e) { return !seiIds[e[0]]; }).slice(0, 5);
    var fontes = pool.slice().sort(function (a, b) { return b._ts - a._ts; }).slice(0, 4);
    var pct = function (c) { return Math.round(100 * c / n); };

    var barras = essenciais.map(function (e) {
      return '<div class="barra-linha"><span class="barra-nome">' + esc(nomeSkill(e[0])) + (seiIds[e[0]] ? ICONE_OK : '') + '</span>' +
        '<div class="barra-trilho" role="img" aria-label="' + pct(e[1]) + '% das vagas"><div class="barra-valor" style="width:' + pct(e[1]) + '%"></div></div>' +
        '<span class="barra-pct">' + pct(e[1]) + '%</span></div>';
    }).join('');
    // Diferenciais só existem com vagas enriquecidas por LLM: a palavra-chave não separa obrigatória de desejável.
    var dif = diferenciais.length
      ? '<h3 style="margin-top:12px">DIFERENCIAIS</h3><div class="opcoes">' + diferenciais.map(function (d) { return '<span class="chip-fraco">' + esc(nomeSkill(d[0])) + '</span>'; }).join('') + '</div>'
      : '';
    var prioridades = !informou
      ? '<p class="nota">Preencha “O que eu já sei” para ver o que falta no seu perfil.</p>'
      : falta.length
        ? '<ol class="passos">' + falta.map(function (e, i) {
            return '<li><span class="passo-n">' + (i + 1) + '</span><span class="passo-texto"><strong>' + esc(nomeSkill(e[0])) + '</strong>' +
              '<span>pedida em ' + pct(e[1]) + '% das vagas deste perfil</span></span></li>';
          }).join('') + '</ol>'
        : '<p class="nota">Você já cobre todas as stacks essenciais deste perfil.</p>';
    if (informou) {
      var conhecidas = Object.keys(seiIds).map(nomeSkill);
      var foraDoTopo = Object.keys(seiIds).filter(function (id) { return idsEss.indexOf(id) < 0; }).map(nomeSkill);
      prioridades = '<p class="nota">Considerando que você já sabe: <strong>' + conhecidas.map(esc).join(', ') + '</strong>.' +
        (foraDoTopo.length ? ' ' + foraDoTopo.map(esc).join(', ') + (foraDoTopo.length > 1 ? ' não estão' : ' não está') + ' entre as mais pedidas deste perfil.' : '') +
        '</p>' + prioridades;
    }
    if (naoReconhecidas.length) {
      prioridades += '<p class="nota">Não reconhecidas na taxonomia: ' + naoReconhecidas.map(esc).join(', ') + '.</p>';
    }
    var linkFiltro = '#/?' + (perfil.sen ? 'sen=' + perfil.sen : '');

    alvo.innerHTML =
      '<div class="resultado-topo"><div><h2>' + esc(titulo) + '</h2>' +
        '<span>Baseado em ' + n + (n === 1 ? ' vaga aberta' : ' vagas abertas') + ' com stacks identificadas</span></div>' +
        (n < 20 ? '<span class="aviso">AMOSTRA PEQUENA</span>' : '') +
      '</div>' +
      '<div class="resultado-grade">' +
        '<div class="coluna"><h3>MAIS PEDIDAS · % DAS VAGAS QUE CITAM</h3>' + barras + dif + '</div>' +
        '<div class="coluna"><h3>O QUE PRIORIZAR</h3>' + prioridades + '</div>' +
      '</div>' +
      '<div class="fontes"><span class="rotulo">Vagas usadas no cálculo (mais recentes)</span><div class="fontes-lista">' +
        fontes.map(function (v) { return '<a href="#/vaga/' + encodeURIComponent(v.id) + '">' + esc(v.titulo) + ' · ' + esc(v.empresa) + '</a>'; }).join('') +
        '<a href="' + linkFiltro + '">+ ver todas no filtro</a></div></div>';
  }

  // ---------------------------------------------------------------- perfil do candidato

  function htmlCandidato() {
    var u = Conta.usuario();
    if (!Conta.ativa) {
      return '<div class="pagina-candidato">' +
        '<div class="perfil-intro"><span class="sobretitulo">PERFIL DO CANDIDATO</span>' +
          '<h1>Minhas vagas salvas</h1>' +
          '<p>O login não está disponível neste ambiente, então as vagas salvas ficam só neste navegador.</p></div>' +
        '<section class="resultados" aria-live="polite" data-salvas></section>' +
      '</div>';
    }
    if (!u) {
      return '<div class="pagina-candidato">' +
        '<div class="perfil-intro"><span class="sobretitulo">PERFIL DO CANDIDATO</span>' +
          '<h1>Seu perfil no portal</h1>' +
          '<p>Entre para salvar vagas e guardar o que você já sabe. Seus dados ficam na sua conta e aparecem em qualquer aparelho.</p></div>' +
        '<div class="vazio"><strong>Você ainda não entrou</strong>' +
          '<span>Não precisa de senha: enviamos um link de acesso para o seu e-mail.</span>' +
          '<a class="botao-primario" href="#/entrar">Entrar</a></div>' +
      '</div>';
    }
    var p = perfilConta || {};
    var areas = '<option value="">Qualquer área</option>' + Object.keys(AREAS).map(function (a) {
      return '<option value="' + a + '"' + (p.area === a ? ' selected' : '') + '>' + AREAS[a] + '</option>';
    }).join('');
    var niveis = '<option value="">Qualquer nível</option>' + NIVEIS.map(function (n) {
      return '<option value="' + n[0] + '"' + (p.senioridade === n[0] ? ' selected' : '') + '>' + n[1] + '</option>';
    }).join('');
    return '<div class="pagina-candidato">' +
      '<div class="perfil-intro"><span class="sobretitulo">PERFIL DO CANDIDATO</span>' +
        '<h1>Olá' + (p.nome ? ', ' + esc(p.nome.split(' ')[0]) : '') + '</h1>' +
        '<p>Suas vagas salvas e o que você já sabe ficam na sua conta.</p></div>' +
      '<div class="candidato-grade">' +
        '<div class="candidato-principal">' +
          htmlPainelSkills() +
          '<section class="resultados" aria-live="polite" data-salvas><p class="nota">Carregando suas vagas…</p></section>' +
        '</div>' +
        '<aside class="candidato-lado">' +
          '<form class="formulario" data-acao="salvar-perfil">' +
            '<h2 class="painel-titulo">Meus dados</h2>' +
            '<div class="grupo"><label class="rotulo" for="p-nome">Nome</label>' +
              '<input id="p-nome" class="campo" type="text" maxlength="120" autocomplete="name" value="' + esc(p.nome || '') + '"></div>' +
            '<div class="grupo"><label class="rotulo" for="p-area">Área de interesse</label><select id="p-area" class="seletor">' + areas + '</select></div>' +
            '<div class="grupo"><label class="rotulo" for="p-sen">Nível que busco</label><select id="p-sen" class="seletor">' + niveis + '</select></div>' +
            '<button type="submit" class="botao-cheio">Salvar perfil</button>' +
            '<a class="link-simples" href="' + linkResultadoPerfil({ area: p.area, sen: p.senioridade, sei: (p.habilidades || []).join(', ') }) + '">Ver o que o mercado pede para este perfil →</a>' +
            '<a class="link-simples" href="#/boas-vindas" data-refazer-onboarding>Refazer a configuração inicial</a>' +
          '</form>' +
          '<section class="painel">' +
            '<h2 class="painel-titulo">Conta</h2>' +
            '<span class="nota">Conectada como <strong>' + esc(u.email || '') + '</strong></span>' +
            '<button type="button" class="botao-secundario" data-acao="sair">Sair</button>' +
            '<details class="zona-perigo"><summary>Excluir minha conta</summary>' +
              '<p class="nota">Apaga sua conta, seu perfil e todas as vagas salvas. Não dá para desfazer.</p>' +
              '<button type="button" class="botao-perigo" data-acao="excluir-conta">Excluir conta e dados</button>' +
            '</details>' +
          '</section>' +
        '</aside>' +
      '</div>' +
    '</div>';
  }

  // ---------------------------------------------------------------- entrar

  function htmlEntrar(p) {
    var motivo = p.motivo === 'salvar'
      ? 'Entre para salvar esta vaga e acessá-la de qualquer aparelho.'
      : 'Salve vagas e guarde o que você já sabe para comparar com o que o mercado pede.';
    if (!Conta.ativa) {
      return '<div class="pagina-entrar"><div class="painel cartao-entrar"><h1>Login indisponível</h1>' +
        '<p class="nota">O login não está configurado neste ambiente. As vagas salvas ficam só neste navegador.</p>' +
        '<a class="botao-primario" href="#/">Voltar para as vagas</a></div></div>';
    }
    var nomes = { github: 'GitHub', google: 'Google', linkedin_oidc: 'LinkedIn' };
    var provedores = Conta.provedores.filter(function (x) { return nomes[x]; }).map(function (x) {
      return '<button type="button" class="botao-secundario" data-provedor="' + x + '">Entrar com ' + nomes[x] + '</button>';
    }).join('');
    return '<div class="pagina-entrar"><div class="painel cartao-entrar">' +
      '<span class="sobretitulo">ENTRAR</span>' +
      '<h1>Acesse seu perfil</h1>' +
      '<p class="texto-apoio">' + motivo + '</p>' +
      '<form class="pilha" data-acao="entrar">' +
        '<label class="rotulo" for="email">E-mail</label>' +
        '<input id="email" class="campo" type="email" required autocomplete="email" inputmode="email" placeholder="voce@exemplo.com">' +
        '<button type="submit" class="botao-cheio">Enviar link de acesso</button>' +
        '<span class="nota">Não precisa de senha: você recebe um link no e-mail e entra com um clique.</span>' +
      '</form>' +
      '<div class="status-entrar" role="status" data-status-entrar></div>' +
      (provedores ? '<div class="divisor-texto"><span>ou</span></div><div class="pilha">' + provedores + '</div>' : '') +
      '<p class="nota privacidade">Guardamos seu e-mail, as vagas que você salvar e o que você preencher no perfil, ' +
        'só para mostrar o seu perfil. Nada é compartilhado. Você pode excluir tudo a qualquer momento em Meu perfil.</p>' +
    '</div></div>';
  }

  function renderSalvas() {
    var alvo = raiz.querySelector('[data-salvas]');
    if (!alvo) return;
    var lista = salvas.listar();
    if (!lista.length) {
      alvo.innerHTML = '<div class="vazio"><strong>Você ainda não salvou nenhuma vaga</strong>' +
        '<span>Use o botão ' + ICONE_SALVAR + ' nas vagas que te interessarem. <a href="#/">Ver vagas</a></span></div>';
      return;
    }
    var abertas = lista.filter(function (s) { return POR_ID[s.id]; });
    var encerradas = lista.filter(function (s) { return !POR_ID[s.id]; });
    alvo.innerHTML =
      '<div class="resultados-topo"><p><strong>' + lista.length + '</strong> ' + (lista.length === 1 ? 'vaga salva' : 'vagas salvas') + '</p></div>' +
      abertas.map(function (s) { return htmlCartao(POR_ID[s.id]); }).join('') +
      (encerradas.length
        ? '<h2 class="subtitulo-lista">Fora da coleta atual</h2>' +
          '<p class="nota">Estas vagas não apareceram na última coleta: podem ter sido encerradas. Confira na Gupy.</p>' +
          encerradas.map(function (s) {
            return '<article class="cartao cartao-encerrado">' +
              '<div class="sigla" aria-hidden="true">' + esc(sigla(s.empresa)) + '</div>' +
              '<div class="cartao-corpo"><span class="cartao-titulo">' + esc(s.titulo || 'Vaga salva') + '</span>' +
                '<span class="cartao-info">' + esc(s.empresa || '') + '</span>' +
                '<div class="etiquetas"><span class="etiqueta-neutra">fora da coleta atual</span></div></div>' +
              '<div class="cartao-lado">' +
                (s.url ? '<a class="fonte" href="' + esc(s.url) + '" target="_blank" rel="noopener">abrir na Gupy</a>' : '') +
                '<button type="button" class="salvar" data-salvar="' + esc(s.id) + '" aria-pressed="true" aria-label="Remover dos salvos: ' + esc(s.titulo || '') + '">' + ICONE_SALVAR + '</button>' +
              '</div></article>';
          }).join('')
        : '');
  }

  // ---------------------------------------------------------------- aderência (perfil × vaga)

  var ORDEM_NIVEL = ['entrada', 'junior', 'pleno', 'senior', 'especialista'];
  var ICONES_ENCAIXE = {
    ok: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"></path></svg>',
    atencao: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M12 6v8M12 18h.01"></path></svg>',
    neutro: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12"></path></svg>'
  };

  // Texto livre ("SQL, pyspark") -> ids da taxonomia, incluindo as skills-pai (Glue -> AWS).
  function idsDasHabilidades(texto) {
    var ids = {}, naoReconhecidas = [];
    (texto || '').split(/[,;\n]/).map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (s) {
      var id = D.sinonimos[chaveSkill(s)];
      if (!id) { naoReconhecidas.push(s); return; }
      for (var atual = id, n = 0; atual && n < 10; atual = (D.pais || {})[atual], n++) ids[atual] = true;
    });
    return { ids: ids, naoReconhecidas: naoReconhecidas };
  }

  function habilidadesAtuais() {
    return perfil.sei || (perfilConta && perfilConta.habilidades ? perfilConta.habilidades.join(', ') : '');
  }

  function encaixeNivel(vaga, alvo) {
    if (!alvo) return ['neutro', 'Você não informou o nível que busca.'];
    if (!vaga) return ['neutro', 'A vaga não deixa o nível claro.'];
    if (vaga === alvo) return ['ok', 'A vaga é ' + NOME_NIVEL[vaga] + ', o nível que você busca.'];
    var d = ORDEM_NIVEL.indexOf(vaga) - ORDEM_NIVEL.indexOf(alvo);
    if (ORDEM_NIVEL.indexOf(vaga) >= 0 && ORDEM_NIVEL.indexOf(alvo) >= 0 && Math.abs(d) === 1) {
      return ['atencao', 'A vaga é ' + NOME_NIVEL[vaga] + ', um nível ' + (d > 0 ? 'acima' : 'abaixo') + ' do que você busca (' + NOME_NIVEL[alvo] + ').'];
    }
    return ['atencao', 'A vaga é ' + NOME_NIVEL[vaga] + '; você busca ' + NOME_NIVEL[alvo] + '.'];
  }

  function encaixeArea(vaga, alvo) {
    if (!alvo) return ['neutro', 'Você não informou a área de interesse.'];
    if (!vaga) return ['neutro', 'Não identificamos a área da vaga pelo título.'];
    if (vaga === alvo) return ['ok', 'A vaga é de ' + AREAS[vaga] + ', a sua área de interesse.'];
    return ['atencao', 'A vaga é de ' + AREAS[vaga] + '; sua área de interesse é ' + AREAS[alvo] + '.'];
  }

  function htmlAderencia(v) {
    if (!v) return htmlVaga(null);
    return '<div class="pagina-vaga">' +
      '<nav aria-label="Trilha" class="trilha-nav"><a href="#/">Vagas</a><span aria-hidden="true">/</span>' +
        '<a href="#/vaga/' + encodeURIComponent(v.id) + '">' + esc(v.titulo) + '</a><span aria-hidden="true">/</span><span>Aderência</span></nav>' +
      '<div data-aderencia></div>' +
    '</div>';
  }

  function renderAderencia(v) {
    var alvo = raiz.querySelector('[data-aderencia]');
    if (!alvo || !v) return;
    var sei = habilidadesAtuais();
    var conhecidas = idsDasHabilidades(sei);
    var informou = Object.keys(conhecidas.ids).length > 0;
    var stacks = v._principais.length ? v._principais : v._stacks;
    var desejaveis = v.enriquecida ? v.desejaveis.filter(function (id) { return stacks.indexOf(id) < 0; }) : [];

    // "O que falta" em ordem de prioridade: quanto a stack é pedida em vagas da mesma área.
    var similares = VISIVEIS.filter(function (x) { return x._stacks.length && (!v.area || x.area === v.area); });
    var freq = {};
    contar(similares, function (x) { return x._principais; }).forEach(function (e) { freq[e[0]] = e[1]; });
    var tem = stacks.filter(function (id) { return conhecidas.ids[id]; });
    var falta = stacks.filter(function (id) { return !conhecidas.ids[id]; })
      .sort(function (a, b) { return (freq[b] || 0) - (freq[a] || 0); });
    var pct = stacks.length ? Math.round(100 * tem.length / stacks.length) : null;
    var pctMercado = function (id) { return similares.length ? Math.round(100 * (freq[id] || 0) / similares.length) : 0; };
    var nomeGrupo = v.area && AREAS[v.area] ? 'vagas de ' + AREAS[v.area] : 'vagas abertas';

    var nivelAlvo = perfil.sen || (perfilConta && perfilConta.senioridade) || null;
    var areaAlvo = perfil.area || (perfilConta && perfilConta.area) || null;
    var encaixes = [encaixeNivel(v.senioridade, nivelAlvo), encaixeArea(v.area, areaAlvo)];
    if (v.modelo) encaixes.push(['neutro', 'Modelo de trabalho: ' + MODELOS[v.modelo] + (local(v) ? ' · ' + local(v) : '') + '.']);
    var rotuloEncaixe = { ok: 'compatível', atencao: 'atenção', neutro: 'informação' };

    var placar = !stacks.length
      ? '<p class="nota">Não identificamos stacks nesta vaga. Confira a descrição completa.</p>'
      : !informou
        ? '<div class="placar"><strong>—</strong><span>Preencha “Suas habilidades” para calcular a aderência.</span></div>'
        : '<div class="placar"><strong>' + pct + '%</strong><span>das stacks da vaga você já tem (' + tem.length + ' de ' + stacks.length + ')</span></div>' +
          '<div class="barra-trilho barra-grande" role="img" aria-label="Aderência de ' + pct + '%"><div class="barra-valor" style="width:' + pct + '%"></div></div>';

    var chipsTem = tem.length
      ? '<div class="opcoes">' + tem.map(function (id) { return '<span class="chip-ok">' + ICONE_OK + esc(nomeSkill(id)) + '</span>'; }).join('') + '</div>'
      : '<p class="nota">' + (informou ? 'Nenhuma das stacks desta vaga está nas suas habilidades.' : 'Informe suas habilidades para ver o que você já tem.') + '</p>';
    var listaFalta = !falta.length
      ? '<p class="nota">' + (stacks.length ? 'Você já tem todas as stacks identificadas nesta vaga.' : '—') + '</p>'
      : '<ol class="passos">' + falta.map(function (id, i) {
          return '<li><span class="passo-n">' + (i + 1) + '</span><span class="passo-texto"><strong>' + esc(nomeSkill(id)) + '</strong>' +
            '<span>pedida em ' + pctMercado(id) + '% das ' + esc(nomeGrupo) + '</span></span></li>';
        }).join('') + '</ol>';
    var logado = !!(Conta.usuario && Conta.usuario());

    alvo.innerHTML =
      '<div class="aderencia-grade">' +
        '<section class="painel aderencia-resumo">' +
          '<span class="sobretitulo">ADERÊNCIA À VAGA</span>' +
          '<h1>' + esc(v.titulo) + '</h1>' +
          '<span class="nota">' + [v.empresa, local(v), MODELOS[v.modelo]].filter(Boolean).map(esc).join(' · ') + '</span>' +
          placar +
          '<ul class="encaixes">' + encaixes.map(function (e) {
            return '<li class="encaixe encaixe-' + e[0] + '"><span class="encaixe-icone" role="img" aria-label="' + rotuloEncaixe[e[0]] + '">' + ICONES_ENCAIXE[e[0]] + '</span><span>' + esc(e[1]) + '</span></li>';
          }).join('') + '</ul>' +
          '<div class="acoes">' +
            '<a class="botao-primario" href="' + esc(v.url) + '" target="_blank" rel="noopener">Candidatar-se na Gupy ' + ICONE_EXTERNO + '</a>' +
            '<button type="button" class="botao-secundario" data-salvar="' + esc(v.id) + '" aria-pressed="' + salvas.tem(v.id) + '">' + (salvas.tem(v.id) ? 'Vaga salva' : 'Salvar vaga') + '</button>' +
          '</div>' +
        '</section>' +
        '<section class="painel">' +
          '<h2 class="painel-titulo">Você já tem</h2>' + chipsTem +
          '<h2 class="painel-titulo">O que falta</h2>' + listaFalta +
          (desejaveis.length ? '<h2 class="painel-titulo">Diferenciais da vaga</h2><div class="opcoes">' +
            desejaveis.map(function (id) { return '<span class="' + (conhecidas.ids[id] ? 'chip-ok' : 'chip-fraco') + '">' + (conhecidas.ids[id] ? ICONE_OK : '') + esc(nomeSkill(id)) + '</span>'; }).join('') + '</div>' : '') +
          '<p class="nota">Stacks ' + (v.enriquecida ? 'extraídas por IA' : 'identificadas por palavra-chave') + ' na descrição. Revise a vaga completa antes de se candidatar.</p>' +
        '</section>' +
        '<form class="painel formulario" data-acao="aderencia">' +
          '<h2 class="painel-titulo">Suas habilidades</h2>' +
          '<label class="rotulo" for="a-sei">O que eu já sei</label>' +
          '<input id="a-sei" class="campo" type="text" autocomplete="off" placeholder="ex.: SQL, Python, Power BI" value="' + esc(sei) + '">' +
          (conhecidas.naoReconhecidas.length ? '<p class="nota">Não reconhecidas na taxonomia: ' + conhecidas.naoReconhecidas.map(esc).join(', ') + '.</p>' : '') +
          '<button type="submit" class="botao-cheio">' + (logado ? 'Recalcular e salvar no perfil' : 'Recalcular') + '</button>' +
          (logado ? '' : '<p class="nota">' + (Conta.ativa ? '<a href="#/entrar">Entre</a> para guardar suas habilidades no perfil.' : 'Suas habilidades valem só nesta visita.') + '</p>') +
        '</form>' +
      '</div>';
  }

  // ---------------------------------------------------------------- minhas skills (Meu perfil)

  // Nome canônico da taxonomia quando reconhecida ("sql" -> "SQL"); senão, o texto como digitado.
  function skillCanonica(s) {
    var id = D.sinonimos[chaveSkill(s)];
    return id ? nomeSkill(id) : s.trim();
  }

  function minhasSkills() {
    var vistas = {}, lista = [];
    ((perfilConta && perfilConta.habilidades) || []).forEach(function (s) {
      var c = skillCanonica(s), k = chaveSkill(c);
      if (c && !vistas[k]) { vistas[k] = true; lista.push(c); }
    });
    return lista;
  }

  function htmlPainelSkills() {
    var nomes = Object.keys(D.skills).map(function (id) { return D.skills[id]; }).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
    return '<section class="painel painel-skills" aria-labelledby="titulo-skills">' +
      '<div class="painel-topo"><h2 class="painel-titulo" id="titulo-skills">Minhas skills</h2>' +
        '<span class="nota" role="status" data-status-skills></span></div>' +
      '<div class="chips-editaveis" data-chips></div>' +
      '<form class="skills-add" data-acao="add-skill">' +
        '<label class="sr" for="nova-skill">Adicionar skill</label>' +
        '<input id="nova-skill" class="campo" list="lista-skills" autocomplete="off" placeholder="Adicionar skill (ex.: Airflow, dbt, Power BI)">' +
        '<button type="submit" class="botao-secundario">Adicionar</button>' +
      '</form>' +
      '<datalist id="lista-skills">' + nomes.map(function (n) { return '<option value="' + esc(n) + '"></option>'; }).join('') + '</datalist>' +
      '<div data-cobertura></div>' +
      '<div data-sugestoes></div>' +
    '</section>';
  }

  function renderPainelSkills() {
    var chips = raiz.querySelector('[data-chips]');
    if (!chips) return;
    var lista = minhasSkills();
    var conhecidas = idsDasHabilidades(lista.join(', ')).ids;

    chips.innerHTML = lista.length
      ? lista.map(function (s, i) {
          var reconhecida = !!D.sinonimos[chaveSkill(s)];
          return '<span class="chip-skill' + (reconhecida ? '' : ' chip-skill-fora') + '"' +
            (reconhecida ? '' : ' title="Fora da taxonomia: não entra no cálculo de aderência"') + '>' + esc(s) +
            (reconhecida ? '' : '<span class="sr"> (fora da taxonomia)</span>') +
            '<button type="button" data-remover-skill="' + i + '" aria-label="Remover ' + esc(s) + '">×</button></span>';
        }).join('')
      : '<p class="nota">Você ainda não adicionou skills. Elas são usadas para calcular sua aderência às vagas.</p>';

    // Base de comparação: vagas abertas da área de interesse (ou todas).
    var area = perfilConta && AREAS[perfilConta.area] ? perfilConta.area : '';
    var pool = VISIVEIS.filter(function (v) { return v._stacks.length && contaNoMercado(v, area); });
    var ranking = contar(pool, function (v) { return v._principais; });
    var top = ranking.slice(0, 10);
    var nomeGrupo = area ? AREAS[area] : 'vagas de dados';
    var pct = function (c) { return pool.length ? Math.round(100 * c / pool.length) : 0; };

    var cobertura = raiz.querySelector('[data-cobertura]');
    if (cobertura) {
      var cobre = top.filter(function (e) { return conhecidas[e[0]]; }).length;
      cobertura.innerHTML = !pool.length ? '' :
        '<div class="cobertura">' +
          '<p><strong>Você tem ' + cobre + ' das ' + top.length + ' skills mais pedidas em ' + esc(nomeGrupo) + '.</strong></p>' +
          '<span class="selo-aderencia-barra cobertura-barra" aria-hidden="true"><span style="width:' + Math.round(100 * cobre / (top.length || 1)) + '%"></span></span>' +
          '<a class="link-simples" href="' + linkResultadoPerfil({ area: area, sen: perfilConta && perfilConta.senioridade, sei: lista.join(', ') }) + '">Ver o que falta →</a>' +
          (area ? '' : '<span class="nota">Escolha uma área de interesse em “Meus dados” para comparar com vagas da sua área.</span>') +
        '</div>';
    }

    var sugestoes = raiz.querySelector('[data-sugestoes]');
    if (sugestoes) {
      var faltam = ranking.filter(function (e) { return !conhecidas[e[0]]; }).slice(0, 6);
      sugestoes.innerHTML = !faltam.length ? '' :
        '<p class="rotulo">Mais pedidas que você ainda não tem</p>' +
        '<div class="opcoes">' + faltam.map(function (e) {
          return '<button type="button" class="chip-botao" data-add-skill="' + esc(nomeSkill(e[0])) + '">+ ' + esc(nomeSkill(e[0])) +
            ' <span class="chip-pct">' + pct(e[1]) + '%</span></button>';
        }).join('') + '</div>';
    }
  }

  var esperaSkills;
  function alterarSkills(nova) {
    if (!perfilConta) return;
    perfilConta.habilidades = nova;
    perfil.sei = nova.join(', ');
    renderPainelSkills();
    var status = raiz.querySelector('[data-status-skills]');
    if (status) status.textContent = 'Salvando…';
    clearTimeout(esperaSkills);
    esperaSkills = setTimeout(function () {
      var dados = Object.assign({}, perfilConta, { habilidades: nova });
      Conta.gravarPerfil(dados).then(function () {
        var st = raiz.querySelector('[data-status-skills]'); if (st) st.textContent = 'Salvo';
      }).catch(function (err) {
        console.error(err);
        var st = raiz.querySelector('[data-status-skills]'); if (st) st.textContent = 'Não foi possível salvar';
        aviso('Não foi possível salvar suas skills. Tente de novo.');
      });
    }, 600);
  }

  function adicionarSkill(texto) {
    var nova = minhasSkills();
    texto.split(/[,;\n]/).map(skillCanonica).filter(Boolean).forEach(function (s) {
      if (!nova.some(function (x) { return chaveSkill(x) === chaveSkill(s); })) nova.push(s);
    });
    alterarSkills(nova.slice(0, 100));
  }

  // ---------------------------------------------------------------- onboarding (primeiro login)

  var onb = null; // { passo, area, sen, skills, destino } enquanto a pessoa está no fluxo
  var TOTAL_PASSOS = 3;

  function iniciarOnboarding(destino) {
    var p = perfilConta || {};
    onb = {
      passo: 1,
      area: AREAS[p.area] ? p.area : '',
      sen: NOME_NIVEL[p.senioridade] ? p.senioridade : '',
      skills: minhasSkills(),
      destino: destino || null
    };
  }

  function htmlOpcoesCartao(nome, opcoes, atual) {
    return '<div class="opcoes-cartao">' + opcoes.map(function (o) {
      return '<label class="cartao-opcao"><input type="radio" name="' + nome + '" value="' + esc(o[0]) + '"' +
        (o[0] === atual ? ' checked' : '') + '><span>' + esc(o[1]) + '</span></label>';
    }).join('') + '</div>';
  }

  function sugestoesOnboarding() {
    var pool = VISIVEIS.filter(function (v) { return v._stacks.length && contaNoMercado(v, onb.area); });
    var total = pool.length || 1;
    return contar(pool, function (v) { return v._principais; }).slice(0, 12).map(function (e) {
      return { nome: nomeSkill(e[0]), pct: Math.round(100 * e[1] / total) };
    });
  }

  function htmlOnboarding() {
    var passo = onb.passo, corpo;
    if (passo === 1) {
      corpo = '<h1 tabindex="-1">Qual área você busca?</h1>' +
        '<p class="texto-apoio">Usamos isso para comparar você com as vagas certas e mostrar o que o mercado pede.</p>' +
        '<fieldset><legend class="sr">Área de interesse</legend>' +
        htmlOpcoesCartao('onb-area', Object.keys(AREAS).map(function (a) { return [a, AREAS[a]]; }).concat([['', 'Ainda não sei']]), onb.area) +
        '</fieldset>';
    } else if (passo === 2) {
      corpo = '<h1 tabindex="-1">Em que nível?</h1>' +
        '<p class="texto-apoio">O nível das vagas que você quer encontrar agora.</p>' +
        '<fieldset><legend class="sr">Nível que você busca</legend>' +
        htmlOpcoesCartao('onb-sen', NIVEIS.concat([['', 'Ainda não sei']]), onb.sen) +
        '</fieldset>';
    } else {
      var escolhidas = {};
      onb.skills.forEach(function (s) { escolhidas[chaveSkill(s)] = true; });
      var sugestoes = sugestoesOnboarding();
      var nomes = Object.keys(D.skills).map(function (id) { return D.skills[id]; }).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
      corpo = '<h1 tabindex="-1">O que você já sabe?</h1>' +
        '<p class="texto-apoio">Marque as tecnologias que você usa. É com elas que calculamos sua aderência às vagas.</p>' +
        (sugestoes.length
          ? '<p class="rotulo">Mais pedidas' + (onb.area ? ' em ' + esc(AREAS[onb.area]) : '') + '</p>' +
            '<div class="opcoes">' + sugestoes.map(function (s) {
              var on = !!escolhidas[chaveSkill(s.nome)];
              return '<button type="button" class="chip-botao" data-onb-skill="' + esc(s.nome) + '" aria-pressed="' + on + '">' +
                (on ? '✓ ' : '+ ') + esc(s.nome) + ' <span class="chip-pct">' + s.pct + '%</span></button>';
            }).join('') + '</div>'
          : '') +
        '<form class="skills-add" data-acao="onb-add-skill">' +
          '<label class="sr" for="onb-skill">Adicionar outra skill</label>' +
          '<input id="onb-skill" class="campo" list="onb-lista-skills" autocomplete="off" placeholder="Outra skill (ex.: Airflow, dbt)">' +
          '<button type="submit" class="botao-secundario">Adicionar</button>' +
        '</form>' +
        '<datalist id="onb-lista-skills">' + nomes.map(function (n) { return '<option value="' + esc(n) + '"></option>'; }).join('') + '</datalist>' +
        (onb.skills.length
          ? '<p class="rotulo">Suas skills (' + onb.skills.length + ')</p><div class="chips-editaveis">' + onb.skills.map(function (s, i) {
              return '<span class="chip-skill">' + esc(s) + '<button type="button" data-onb-remover="' + i + '" aria-label="Remover ' + esc(s) + '">×</button></span>';
            }).join('') + '</div>'
          : '<p class="nota">Nenhuma skill ainda. Você pode continuar assim e preencher depois em Meu perfil.</p>');
    }
    return '<div class="pagina-onboarding">' +
      '<div class="onb-topo"><span class="sobretitulo">BOAS-VINDAS AO PORTAL</span><span class="nota">Passo ' + passo + ' de ' + TOTAL_PASSOS + '</span></div>' +
      '<div class="onb-progresso" role="progressbar" aria-label="Progresso da configuração" aria-valuemin="1" aria-valuemax="' + TOTAL_PASSOS + '" aria-valuenow="' + passo + '">' +
        '<span style="width:' + Math.round(100 * passo / TOTAL_PASSOS) + '%"></span></div>' +
      '<section class="painel onb-passo">' + corpo + '</section>' +
      '<div class="onb-acoes">' +
        '<button type="button" class="link-botao" data-onb="pular">Pular por agora</button>' +
        '<div class="onb-navegacao">' +
          (passo > 1 ? '<button type="button" class="botao-secundario" data-onb="voltar">Voltar</button>' : '') +
          '<button type="button" class="botao-cheio" data-onb="' + (passo < TOTAL_PASSOS ? 'continuar' : 'concluir') + '">' +
            (passo < TOTAL_PASSOS ? 'Continuar' : 'Concluir e ver vagas') + '</button>' +
        '</div>' +
      '</div>' +
      '<p class="nota onb-rodape">Você pode mudar tudo isso depois em Meu perfil.</p>' +
    '</div>';
  }

  function renderOnboarding() {
    raiz.innerHTML = htmlOnboarding();
    var titulo = raiz.querySelector('.onb-passo h1');
    if (titulo) titulo.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  function concluirOnboarding(pulou) {
    var botoes = raiz.querySelectorAll('[data-onb]');
    botoes.forEach(function (b) { b.disabled = true; });
    var atual = perfilConta || {};
    var dados = pulou
      ? { nome: atual.nome || null, habilidades: atual.habilidades || [], area: atual.area || null, senioridade: atual.senioridade || null }
      : { nome: atual.nome || null, habilidades: onb.skills, area: onb.area || null, senioridade: onb.sen || null };
    Conta.gravarPerfil(dados).then(function () {
      perfilConta = dados;
      perfil.sei = (dados.habilidades || []).join(', ');
      perfil.area = dados.area || '';
      perfil.sen = dados.senioridade || null;
      perfil._preenchido = true;
      var destino = onb.destino || '#/';
      onb = null;
      if (!pulou && dados.habilidades.length) {
        busca.ordem = 'aderentes';
        aviso('Perfil pronto! As vagas estão ordenadas pela sua aderência.');
      }
      irPara(destino);
    }).catch(function (err) {
      console.error(err);
      botoes.forEach(function (b) { b.disabled = false; });
      aviso('Não foi possível salvar agora. Tente de novo.');
    });
  }

  function irPara(hash) {
    if (location.hash === hash) rota(); else location.hash = hash;
  }

  // ---------------------------------------------------------------- rotas

  function parametros(q) {
    var p = {};
    (q || '').split('&').filter(Boolean).forEach(function (par) {
      var kv = par.split('='); p[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
    });
    return p;
  }

  var primeira = true;
  function rota() {
    var hash = location.hash.replace(/^#/, '') || '/';
    var partes = hash.split('?'), caminho = partes[0], p = parametros(partes[1]);
    var nome;

    var mAderencia = caminho.match(/^\/vaga\/(.+)\/aderencia$/);
    if (mAderencia) {
      nome = 'vaga';
      var va = POR_ID[decodeURIComponent(mAderencia[1])];
      raiz.innerHTML = htmlAderencia(va);
      renderAderencia(va);
      document.title = 'Aderência' + (va ? ': ' + va.titulo : '') + ' · Portal de Vagas em Dados';
    } else if (caminho.indexOf('/vaga/') === 0) {
      nome = 'vaga';
      var v = POR_ID[decodeURIComponent(caminho.slice(6))];
      raiz.innerHTML = htmlVaga(v);
      document.title = (v ? v.titulo + ' · ' : '') + 'Portal de Vagas em Dados';
      if (v && !descricoes.prontas()) {
        descricoes.carregar(function (ok) {
          var alvo = raiz.querySelector('[data-descricao="' + CSS.escape(v.id) + '"]');
          if (!alvo) return; // a pessoa já saiu desta vaga
          alvo.textContent = ok ? descricoes.de(v.id) : 'Não foi possível carregar a descrição agora. Veja a vaga completa na Gupy.';
        });
      }
    } else if (caminho === '/perfil' || caminho === '/perfil/resultado') {
      nome = 'perfil';
      if ('area' in p) perfil.area = AREAS[p.area] ? p.area : '';
      if ('sen' in p) perfil.sen = NOME_NIVEL[p.sen] ? p.sen : null;
      if ('sei' in p) perfil.sei = p.sei;
      // Primeira visita logada: parte do que está salvo no perfil da pessoa.
      if (perfilConta && !perfil._preenchido) {
        perfil._preenchido = true;
        if (!perfil.sei && perfilConta.habilidades && perfilConta.habilidades.length) perfil.sei = perfilConta.habilidades.join(', ');
        if (!('area' in p) && !perfil.area && AREAS[perfilConta.area]) perfil.area = perfilConta.area;
        if (!('sen' in p) && !perfil.sen && NOME_NIVEL[perfilConta.senioridade]) perfil.sen = perfilConta.senioridade;
      }
      if (caminho === '/perfil/resultado') {
        raiz.innerHTML = htmlPerfilResultado();
        renderPerfil();
        document.title = 'Resultado do perfil de competências · Portal de Vagas em Dados';
      } else {
        raiz.innerHTML = htmlPerfil();
        document.title = 'Perfil de competências · Portal de Vagas em Dados';
      }
    } else if (caminho === '/candidato') {
      nome = 'candidato';
      raiz.innerHTML = htmlCandidato();
      renderPainelSkills();
      if (carregandoConta) { var ls = raiz.querySelector('[data-salvas]'); if (ls) ls.innerHTML = '<p class="nota">Carregando suas vagas…</p>'; }
      else renderSalvas();
      document.title = 'Meu perfil · Portal de Vagas em Dados';
    } else if (caminho === '/boas-vindas') {
      if (!Conta.usuario || !Conta.usuario()) { location.replace('#/entrar'); return; }
      nome = 'candidato';
      if (!onb) iniciarOnboarding(null);
      renderOnboarding();
      document.title = 'Boas-vindas · Portal de Vagas em Dados';
    } else if (caminho === '/entrar') {
      if (Conta.usuario()) { location.replace('#/candidato'); return; }
      nome = 'candidato';
      raiz.innerHTML = htmlEntrar(p);
      document.title = 'Entrar · Portal de Vagas em Dados';
    } else {
      nome = 'busca';
      if ('sen' in p) { busca.sen = NOME_NIVEL[p.sen] ? p.sen : null; busca.limite = POR_PAGINA; }
      raiz.innerHTML = htmlBusca();
      renderResultados();
      document.title = 'Portal de Vagas em Dados · DSE Academy';
    }

    document.querySelectorAll('.menu a').forEach(function (a) {
      var atual = a.dataset.rota === nome || (nome === 'vaga' && a.dataset.rota === 'busca');
      if (atual) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    fecharMenu();
    // No onboarding o foco já vai para o título do passo (renderOnboarding).
    if (!primeira && caminho !== '/boas-vindas') { window.scrollTo(0, 0); raiz.focus({ preventScroll: true }); }
    primeira = false;
  }

  // ---------------------------------------------------------------- eventos

  var menuBotao = document.querySelector('.menu-botao'), menu = document.getElementById('menu-principal');
  function fecharMenu() { menu.classList.remove('aberto'); menuBotao.setAttribute('aria-expanded', 'false'); menuBotao.setAttribute('aria-label', 'Abrir menu'); }
  menuBotao.addEventListener('click', function () {
    var abrir = !menu.classList.contains('aberto');
    menu.classList.toggle('aberto', abrir);
    menuBotao.setAttribute('aria-expanded', String(abrir));
    menuBotao.setAttribute('aria-label', abrir ? 'Fechar menu' : 'Abrir menu');
  });

  var espera;
  raiz.addEventListener('input', function (e) {
    if (e.target.id === 'busca') {
      clearTimeout(espera);
      espera = setTimeout(function () { busca.q = e.target.value; busca.limite = POR_PAGINA; renderResultados(); }, 180);
    }
  });

  raiz.addEventListener('change', function (e) {
    var t = e.target;
    if (t.id === 'empresa') { busca.empresa = t.value; atualizarBusca(); }
    else if (t.dataset.modelo) {
      busca.modelos = t.checked ? busca.modelos.concat([t.dataset.modelo]) : busca.modelos.filter(function (m) { return m !== t.dataset.modelo; });
      atualizarBusca();
    }
    else if (t.hasAttribute('data-negocio')) { busca.negocio = t.checked; atualizarBusca(); }
    else if (t.name === 'onb-area' && onb) { onb.area = t.value; }
    else if (t.name === 'onb-sen' && onb) { onb.sen = t.value; }
    else if (t.name === 'rep-tipo') {
      var campoStacks = raiz.querySelector('[data-rep-stacks]');
      if (campoStacks) campoStacks.hidden = t.value !== 'stack_errada';
    }
    else if (t.hasAttribute('data-ordem')) { busca.ordem = t.value; renderResultados(); }
    else if (t.id === 'funcao') { perfil.area = t.value; }
  });

  raiz.addEventListener('submit', function (e) {
    e.preventDefault();
    var acao = e.target.dataset.acao;
    if (acao === 'buscar') {
      busca.q = raiz.querySelector('#busca').value;
      if (busca.q && busca.ordem === 'recentes') busca.ordem = 'relevantes';
      atualizarBusca();
      var res = raiz.querySelector('[data-resultados]');
      if (res && window.matchMedia('(max-width: 900px)').matches) res.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (acao === 'entrar') {
      enviarLinkDeAcesso(raiz.querySelector('#email').value.trim(), e.target.querySelector('button[type=submit]'));
    } else if (acao === 'salvar-perfil') {
      salvarPerfilDaPagina(e.target.querySelector('button[type=submit]'));
    } else if (acao === 'onb-add-skill') {
      var campoOnb = raiz.querySelector('#onb-skill');
      campoOnb.value.split(/[,;\n]/).map(skillCanonica).filter(Boolean).forEach(function (s) {
        if (!onb.skills.some(function (x) { return chaveSkill(x) === chaveSkill(s); })) onb.skills.push(s);
      });
      renderOnboarding();
      var novoCampo = raiz.querySelector('#onb-skill'); if (novoCampo) novoCampo.focus();
    } else if (acao === 'reportar') {
      enviarRelato(e.target);
    } else if (acao === 'add-skill') {
      var campo = raiz.querySelector('#nova-skill');
      if (campo.value.trim()) adicionarSkill(campo.value);
      campo.value = '';
      campo.focus();
    } else if (acao === 'habilidades-busca') {
      perfil.sei = raiz.querySelector('#b-sei').value.trim();
      renderResultados();
    } else if (acao === 'aderencia') {
      recalcularAderencia(e.target);
    } else if (acao === 'perfil') {
      perfil.sei = raiz.querySelector('#sei').value.trim();
      perfil.area = raiz.querySelector('#funcao').value;
      location.hash = linkResultadoPerfil({ area: perfil.area, sen: perfil.sen, sei: perfil.sei });
    }
  });

  raiz.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if ('sen' in b.dataset) { busca.sen = b.dataset.sen || null; atualizarBusca(); }
    else if ('psen' in b.dataset) {
      perfil.sen = b.dataset.psen || null;
      raiz.querySelectorAll('[data-psen]').forEach(function (x) { x.setAttribute('aria-pressed', String((x.dataset.psen || null) === perfil.sen)); });
    }
    else if (b.dataset.stack) {
      var id = b.dataset.stack;
      busca.stacks = busca.stacks.indexOf(id) >= 0 ? busca.stacks.filter(function (s) { return s !== id; }) : busca.stacks.concat([id]);
      atualizarBusca();
    }
    else if (b.dataset.salvar) {
      var vagaId = b.dataset.salvar;
      if (Conta.ativa && !Conta.usuario()) {
        // Salvar exige conta: guarda a intenção e volta para cá depois do login.
        intencao.guardar({ salvar: vagaId, voltar: location.hash || '#/' });
        location.hash = '#/entrar?motivo=salvar';
        return;
      }
      var promessa = salvas.alternar(vagaId);
      var marcar = function (estado) {
        raiz.querySelectorAll('[data-salvar="' + CSS.escape(vagaId) + '"]').forEach(function (x) {
          x.setAttribute('aria-pressed', String(estado));
          if (x.classList.contains('botao-secundario')) x.textContent = estado ? 'Vaga salva' : 'Salvar vaga';
        });
        atualizarContador();
        if (raiz.querySelector('[data-salvas]')) renderSalvas(); // no perfil, desmarcar remove da lista
      };
      marcar(salvas.tem(vagaId)); // otimista
      promessa.catch(function (err) {
        console.error(err);
        marcar(salvas.tem(vagaId)); // desfeito
        aviso('Não foi possível atualizar suas vagas salvas. Tente de novo.');
      });
    }
    else if (b.dataset.onb && onb) {
      var acaoOnb = b.dataset.onb;
      if (acaoOnb === 'continuar') { onb.passo = Math.min(TOTAL_PASSOS, onb.passo + 1); renderOnboarding(); }
      else if (acaoOnb === 'voltar') { onb.passo = Math.max(1, onb.passo - 1); renderOnboarding(); }
      else if (acaoOnb === 'concluir') concluirOnboarding(false);
      else if (acaoOnb === 'pular') concluirOnboarding(true);
    }
    else if (b.dataset.onbSkill && onb) {
      var nomeS = b.dataset.onbSkill, iS = onb.skills.findIndex(function (x) { return chaveSkill(x) === chaveSkill(nomeS); });
      if (iS >= 0) onb.skills.splice(iS, 1); else onb.skills.push(nomeS);
      renderOnboarding();
      var mesmo = raiz.querySelector('[data-onb-skill="' + CSS.escape(nomeS) + '"]'); if (mesmo) mesmo.focus();
    }
    else if ('onbRemover' in b.dataset && onb) {
      onb.skills.splice(Number(b.dataset.onbRemover), 1);
      renderOnboarding();
    }
    else if ('removerSkill' in b.dataset) {
      var atuais = minhasSkills();
      atuais.splice(Number(b.dataset.removerSkill), 1);
      alterarSkills(atuais);
      var proximo = raiz.querySelector('[data-remover-skill]') || raiz.querySelector('#nova-skill');
      if (proximo) proximo.focus();
    }
    else if (b.dataset.addSkill) {
      adicionarSkill(b.dataset.addSkill);
    }
    else if (b.dataset.provedor) {
      try { if (!localStorage.getItem(intencao.CHAVE)) intencao.guardar({ voltar: '#/candidato' }); } catch (e2) { /* ok */ }
      Conta.entrarCom(b.dataset.provedor).catch(function (err) { console.error(err); aviso('Não foi possível entrar. Tente de novo.'); });
    }
    else if (b.dataset.acao === 'sair') {
      Conta.sair().catch(function (err) { console.error(err); });
    }
    else if (b.dataset.acao === 'excluir-conta') {
      if (!window.confirm('Excluir sua conta, seu perfil e todas as vagas salvas? Não dá para desfazer.')) return;
      b.disabled = true;
      Conta.excluirConta().then(function () {
        aviso('Sua conta e seus dados foram excluídos.');
        location.hash = '#/';
      }).catch(function (err) {
        console.error(err);
        b.disabled = false;
        aviso('Não foi possível excluir a conta agora. Tente de novo.');
      });
    }
    else if (b.dataset.acao === 'limpar') {
      busca = Object.assign({}, BUSCA_INICIAL, { stacks: [], modelos: [] });
      atualizarBusca();
    }
    else if (b.dataset.acao === 'mais') {
      busca.limite += POR_PAGINA;
      renderResultados();
    }
  });

  // No desktop os filtros são uma coluna fixa, sem o botão de recolher: mantém o painel
  // aberto quando a tela passa a ser larga (ex.: carregou no celular e girou/redimensionou).
  var telaLarga = window.matchMedia('(min-width: 901px)');
  function abrirFiltrosSeLarga() {
    var f = raiz.querySelector('.filtros');
    if (f && telaLarga.matches) f.open = true;
  }
  telaLarga.addEventListener('change', abrirFiltrosSeLarga);

  function recalcularAderencia(form) {
    var m = (location.hash || '').match(/^#\/vaga\/(.+)\/aderencia/);
    var v = m && POR_ID[decodeURIComponent(m[1])];
    perfil.sei = raiz.querySelector('#a-sei').value.trim();
    renderAderencia(v);
    if (!(Conta.usuario && Conta.usuario())) return;
    var dados = Object.assign({}, perfilConta || {}, { habilidades: lerHabilidades(perfil.sei) });
    Conta.gravarPerfil(dados).then(function () {
      perfilConta = dados;
      aviso('Habilidades salvas no seu perfil.');
    }).catch(function (err) {
      console.error(err);
      aviso('Aderência recalculada, mas não foi possível salvar no perfil.');
    });
  }

  // ---------------------------------------------------------------- conta

  var carregandoConta = false;

  function enviarLinkDeAcesso(email, botao) {
    var status = raiz.querySelector('[data-status-entrar]');
    if (!email) return;
    botao.disabled = true;
    status.textContent = 'Enviando…';
    // Se veio de um clique em "salvar", a intenção já foi guardada; senão, volta para o perfil.
    try { if (!localStorage.getItem(intencao.CHAVE)) intencao.guardar({ voltar: '#/candidato' }); } catch (e) { /* ok */ }
    Conta.entrarComEmail(email).then(function () {
      status.innerHTML = '<strong>Link enviado para ' + esc(email) + '.</strong> Abra o e-mail neste navegador e clique no link para entrar.';
    }).catch(function (err) {
      console.error(err);
      status.textContent = /rate|limit|seconds/i.test(err.message || '')
        ? 'Muitas tentativas seguidas. Espere um minuto e tente de novo.'
        : 'Não foi possível enviar o link. Confira o e-mail e tente de novo.';
    }).finally(function () { botao.disabled = false; });
  }

  function lerHabilidades(texto) {
    return texto.split(/[,;\n]/).map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 100);
  }

  function salvarPerfilDaPagina(botao) {
    var dados = {
      nome: raiz.querySelector('#p-nome').value.trim().slice(0, 120),
      habilidades: (perfilConta && perfilConta.habilidades) || [],
      area: raiz.querySelector('#p-area').value,
      senioridade: raiz.querySelector('#p-sen').value
    };
    botao.disabled = true;
    Conta.gravarPerfil(dados).then(function () {
      perfilConta = dados;
      // O Perfil de competências passa a partir destes dados.
      perfil.sei = dados.habilidades.join(', ');
      perfil.area = dados.area || '';
      perfil.sen = dados.senioridade || null;
      perfil._preenchido = true;
      renderPainelSkills(); // cobertura e sugestões dependem da área de interesse
      var saudacao = raiz.querySelector('.pagina-candidato h1');
      if (saudacao) saudacao.textContent = 'Olá' + (dados.nome ? ', ' + dados.nome.split(' ')[0] : '');
      aviso('Perfil salvo.');
    }).catch(function (err) {
      console.error(err);
      aviso('Não foi possível salvar o perfil. Tente de novo.');
    }).finally(function () { botao.disabled = false; });
  }

  async function aposLogin() {
    carregandoConta = true;
    try {
      var r = await Promise.all([salvas.carregar(), Conta.carregarPerfil()]);
      var primeiroAcesso = r[1] === null;
      perfilConta = r[1] || {};
      var pendente = intencao.retirar();
      if (pendente && pendente.salvar && !salvas.tem(pendente.salvar)) {
        await salvas.alternar(pendente.salvar);
        aviso('Vaga salva no seu perfil.');
      }
      if (primeiroAcesso) {
        // Depois do onboarding, volta para a vaga que a pessoa tentou salvar (se foi o caso).
        iniciarOnboarding(pendente && pendente.salvar ? pendente.voltar : null);
        carregandoConta = false;
        atualizarContador();
        irPara('#/boas-vindas');
        return;
      }
      if (pendente && pendente.voltar && location.hash !== pendente.voltar) {
        carregandoConta = false;
        atualizarContador();
        location.hash = pendente.voltar;
        return;
      }
    } catch (err) {
      console.error(err);
      aviso('Não foi possível carregar seu perfil. Recarregue a página.');
    }
    carregandoConta = false;
    atualizarContador();
    rota();
  }

  Conta.aoMudar(function (u) {
    if (u) { aposLogin(); return; }
    salvas.esquecer();
    perfilConta = null;
    perfil._preenchido = false;
    atualizarContador();
    rota();
  });

  window.addEventListener('hashchange', rota);
  atualizarContador();
  rota();
  (window.requestIdleCallback || function (f) { setTimeout(f, 1200); })(function () {
    descricoes.carregar(function (ok) {
      // Busca em andamento passa a considerar o texto completo das vagas.
      if (ok && raiz.querySelector('[data-resultados]') && norm(busca.q).trim()) renderResultados();
    });
  });
  if (Conta.ativa) {
    Conta.iniciar().then(function (u) { if (u) aposLogin(); else atualizarContador(); })
      .catch(function (err) { console.error(err); aviso('Não foi possível verificar sua sessão.'); });
  }
})();
