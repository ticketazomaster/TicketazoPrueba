/**
 * Publica el borrador de un chart en seats.io (POST .../version/draft/actions/publish).
 * Configura en Supabase: SEATSIO_SECRET_KEY y opcionalmente SEATSIO_REGION (na|eu|sa|oc).
 */
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, accept, prefer, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

async function _fetchChartName(region: string, secret: string, chartKey: string): Promise<string> {
  const url = `https://api-${region}.seatsio.net/charts/${encodeURIComponent(chartKey)}`
  const token = btoa(`${secret}:`)
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${token}`,
      Accept: 'application/json',
    },
  })
  if (!res.ok) return ''
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  const name = typeof (data as any)?.name === 'string' ? ((data as any).name as string) : ''
  return name.trim()
}

function _defaultEventKey(chartKey: string): string {
  const safe = chartKey.replace(/[^a-zA-Z0-9\-]/g, '')
  return `tkz-${safe}`
}

async function _ensureSeatsioEvent(
  region: string,
  secret: string,
  chartKey: string,
  preferredEventKey?: string,
): Promise<{ eventKey: string; created: boolean }> {
  const token = btoa(`${secret}:`)
  const eventKey = (preferredEventKey || '').trim() || _defaultEventKey(chartKey)

  const getUrl = `https://api-${region}.seatsio.net/events/${encodeURIComponent(eventKey)}`
  const getRes = await fetch(getUrl, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${token}`,
      Accept: 'application/json',
    },
  })

  if (getRes.ok) {
    const data = (await getRes.json().catch(() => ({}))) as Record<string, unknown>
    const k = typeof data?.key === 'string' ? data.key : eventKey
    return { eventKey: k, created: false }
  }

  const postUrl = `https://api-${region}.seatsio.net/events`
  const postRes = await fetch(postUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ chartKey, eventKey }),
  })

  if (postRes.ok || postRes.status === 204) {
    return { eventKey, created: true }
  }

  const errText = await postRes.text()
  let parsed: Record<string, unknown> = {}
  try {
    parsed = JSON.parse(errText) as Record<string, unknown>
  } catch {
    parsed = { raw: errText }
  }

  // Si ya existe por carrera / duplicado, reintenta GET
  const dup =
    postRes.status === 409 ||
    String((parsed as any)?.errors?.[0]?.code || '').toUpperCase().includes('DUPLICATE')

  if (dup) {
    const retry = await fetch(getUrl, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${token}`,
        Accept: 'application/json',
      },
    })
    if (retry.ok) {
      const data = (await retry.json().catch(() => ({}))) as Record<string, unknown>
      const k = typeof data?.key === 'string' ? data.key : eventKey
      return { eventKey: k, created: false }
    }
  }

  throw new Error(`No se pudo crear el evento en seats.io: ${errText}`)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const secret = Deno.env.get('SEATSIO_SECRET_KEY')
  const region = Deno.env.get('SEATSIO_REGION') || 'na'

  if (!secret) {
    return new Response(
      JSON.stringify({
        error: 'Falta SEATSIO_SECRET_KEY en los secrets de la función.',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  try {
    const body = await req.json()
    const action = typeof body?.action === 'string' ? body.action.trim() : ''
    const chartKey = typeof body?.chartKey === 'string' ? body.chartKey.trim() : ''
    const ensureEvent = body?.ensureEvent === true
    const preferredEventKey = typeof body?.eventKey === 'string' ? body.eventKey.trim() : ''
    const publishOnly = body?.publishOnly === true

    // ── Acción: reservar asientos (book) ───────────────────────────────────────
    if (action === 'book') {
      const eventKey = preferredEventKey
      const objects = Array.isArray(body?.objects) ? body.objects.filter((o: unknown) => typeof o === 'string' && o.trim()) : []

      if (!eventKey || !objects.length) {
        return new Response(JSON.stringify({ error: 'eventKey y objects son requeridos para book.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const token = btoa(`${secret}:`)
      const bookUrl = `https://api-${region}.seatsio.net/events/${encodeURIComponent(eventKey)}/actions/book`
      const bookRes = await fetch(bookUrl, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ objects }),
      })

      if (bookRes.ok || bookRes.status === 204) {
        return new Response(JSON.stringify({ ok: true, booked: objects.length }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const errText = await bookRes.text()
      console.error('[seatsio-publish] book error:', bookRes.status, errText)
      return new Response(JSON.stringify({ ok: false, error: `seats.io book: ${bookRes.status} ${errText}` }), {
        status: bookRes.status >= 400 ? bookRes.status : 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Acción: info del plano (total de asientos por categoría) ───────────────
    if (action === 'chartInfo') {
      const ck = typeof body?.chartKey === 'string' ? body.chartKey.trim() : ''
      if (!ck) {
        return new Response(JSON.stringify({ ok: false, totalSeats: 0, categories: [] }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      try {
        const token2 = btoa(`${secret}:`)
        // API de charts devuelve la metadata completa
        const rUrl = `https://api-${region}.seatsio.net/charts/${encodeURIComponent(ck)}/version/published`
        const rRes = await fetch(rUrl, {
          method: 'GET',
          headers: { Authorization: `Basic ${token2}`, Accept: 'application/json' },
        })
        if (!rRes.ok) {
          return new Response(JSON.stringify({ ok: true, totalSeats: 0, categories: [] }), {
            status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
        const chartData = (await rRes.json().catch(() => ({}))) as Record<string, unknown>
        
        let totalSeats = 0
        const cats: Record<string, number> = {}

        const addSeat = (categoryKey: any) => {
           totalSeats++
           const c = String(categoryKey || 'General')
           cats[c] = (cats[c] || 0) + 1
        }

        const traverse = (node: any) => {
           if (!node) return
           if (Array.isArray(node.rows)) {
              node.rows.forEach((r: any) => {
                 if (Array.isArray(r.seats)) r.seats.forEach((s: any) => addSeat(s.categoryKey))
              })
           }
           if (Array.isArray(node.tables)) {
              node.tables.forEach((t: any) => {
                 if (Array.isArray(t.seats)) t.seats.forEach((s: any) => addSeat(s.categoryKey))
                 else if (t.numSeats) {
                    const ct = Number(t.numSeats)
                    if (!isNaN(ct)) {
                      totalSeats += ct
                      const ck2 = String(t.categoryKey || 'General')
                      cats[ck2] = (cats[ck2] || 0) + ct
                    }
                 }
              })
           }
           if (Array.isArray(node.generalAdmissionAreas)) {
              node.generalAdmissionAreas.forEach((ga: any) => {
                 if (ga.capacity) {
                    const ct = Number(ga.capacity)
                    if (!isNaN(ct)) {
                      totalSeats += ct
                      const ck2 = String(ga.categoryKey || 'General')
                      cats[ck2] = (cats[ck2] || 0) + ct
                    }
                 }
              })
           }
           if (Array.isArray(node.sections)) {
              node.sections.forEach((s: any) => traverse(s))
           }
        }
        
        traverse((chartData as any).subChart)
        
        const catMap = Array.isArray((chartData as any)?.categories?.list) ? (chartData as any).categories.list : []
        const cLabels: Record<string, string> = {}
        catMap.forEach((c: any) => { cLabels[String(c.key)] = c.label })
        
        const categories = Object.keys(cats).map(k => ({
           label: cLabels[k] || k,
           count: cats[k]
        }))

        return new Response(JSON.stringify({ ok: true, totalSeats, categories }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      } catch (e) {
        return new Response(JSON.stringify({ ok: true, totalSeats: 0, categories: [] }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    // ── Acción: listar mapas (listCharts) ──────────────────────────────────────
    if (action === 'listCharts') {
      try {
        const token3 = btoa(`${secret}:`)
        // The /charts endpoint supports GET to list all charts
        const listUrl = `https://api-${region}.seatsio.net/charts` // Removes limit=100 because max is 20
        const listRes = await fetch(listUrl, {
          method: 'GET',
          headers: { Authorization: `Basic ${token3}`, Accept: 'application/json' },
        })

        if (!listRes.ok) {
          const errText = await listRes.text();
          return new Response(JSON.stringify({ ok: false, charts: [], error: errText, status: listRes.status }), {
            status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
        
        const listData = (await listRes.json().catch(() => ({}))) as any
        const charts = Array.isArray(listData?.items) ? listData.items.map((c: any) => ({
           id: c.key, 
           name: c.name || c.key,
           status: c.status
        })) : []
        
        return new Response(JSON.stringify({ ok: true, charts }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, charts: [] }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }
    
    // ── Acción: Borrar todos los mapas (deleteAllCharts) ───────────────────────
    if (action === 'deleteAllCharts') {
      try {
        const tokenDel = btoa(`${secret}:`)
        // Listamos primero
        const listRes = await fetch(`https://api-${region}.seatsio.net/charts`, {
          method: 'GET',
          headers: { Authorization: `Basic ${tokenDel}`, Accept: 'application/json' },
        })
        if (listRes.ok) {
           const listData = (await listRes.json().catch(() => ({}))) as any
           const charts = Array.isArray(listData?.items) ? listData.items : []
           for (const chart of charts) {
             // Mover al archivo
             await fetch(`https://api-${region}.seatsio.net/charts/${encodeURIComponent(chart.key)}/actions/move-to-archive`, {
               method: 'POST',
               headers: { Authorization: `Basic ${tokenDel}`, 'Content-Type': 'application/json' },
             })
             // Borrar permanentemente
             await fetch(`https://api-${region}.seatsio.net/charts/${encodeURIComponent(chart.key)}`, {
               method: 'DELETE',
               headers: { Authorization: `Basic ${tokenDel}` },
             })
           }
        }
        return new Response(JSON.stringify({ ok: true, message: 'Todos los mapas borrados de seats.io' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        return new Response(JSON.stringify({ error: message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
    }

    // ── Acción: publicar mapa ──────────────────────────────────────────────────
    if (!chartKey) {
      return new Response(JSON.stringify({ error: 'chartKey requerido.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const url = `https://api-${region}.seatsio.net/charts/${encodeURIComponent(chartKey)}/version/draft/actions/publish`
    const token = btoa(`${secret}:`)

    let publishOk = false
    let alreadyPublished = false

    if (!publishOnly) {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${token}`,
          'Content-Type': 'application/json',
        },
      })

      if (res.status === 204) {
        publishOk = true
      } else {
        const errText = await res.text()
        let parsed: Record<string, unknown> = {}
        try {
          parsed = JSON.parse(errText) as Record<string, unknown>
        } catch {
          parsed = { raw: errText }
        }

        const messages = Array.isArray((parsed as any)?.messages) ? ((parsed as any).messages as unknown[]) : []
        const hasNoDraft =
          messages
            .map((m) => String(m || '').toLowerCase())
            .some((m) => m.includes('does not have a draft version'))
          || String((parsed as any)?.errors?.[0]?.message || '')
            .toLowerCase()
            .includes('does not have a draft version')

        if (hasNoDraft) {
          publishOk = true
          alreadyPublished = true
        } else {
          const out = {
            error: 'No se pudo publicar el mapa en seats.io.',
            seatsio: parsed,
          }
          return new Response(JSON.stringify(out), {
            status: res.status >= 400 ? res.status : 502,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
      }
    } else {
      publishOk = true
      alreadyPublished = true
    }

    const name = await _fetchChartName(region, secret, chartKey).catch(() => '')

    let eventKeyOut = ''
    if (ensureEvent) {
      const ev = await _ensureSeatsioEvent(region, secret, chartKey, preferredEventKey)
      eventKeyOut = ev.eventKey
    }

    return new Response(
      JSON.stringify({
        ok: true,
        chartKey,
        name,
        alreadyPublished: publishOnly ? true : alreadyPublished,
        publishOk,
        eventKey: eventKeyOut || undefined,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    )
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
