const WS = typeof window !== "undefined" ? window.WebSocket : (require("ws") as unknown as typeof WebSocket);

export class DerivAPI {
  ws: WebSocket | null = null;
  token: string | null = null;
  appId = 1089;
  
  onTick: ((tick: { quote: number, epoch: number, symbol: string }) => void) | null = null;
  onOpenContract: ((contract: Record<string, unknown>) => void) | null = null;
  onBalance: ((balance: number) => void) | null = null;
  onLatency: ((ms: number) => void) | null = null;
  
  private reqId = 1;
  private reqMap: Record<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }> = {};

  private readyResolver: (() => void) | null = null;
  public readyPromise: Promise<void> | null = null;

  connect(token?: string) {
    const newToken = token || null;
    
    if (this.ws && (this.ws.readyState === 1 || this.ws.readyState === 0)) {
      if (this.token === newToken) {
        return; // token is the same, already connecting or connected
      }
      // token changed, close the old connection first
      this.ws.onclose = null;
      this.ws.close();
    }
    
    this.token = newToken;
    
    this.readyPromise = new Promise(resolve => {
      this.readyResolver = resolve;
    });

    this.ws = new WS(`wss://ws.binaryws.com/websockets/v3?app_id=${this.appId}`);
    
    this.ws.onopen = () => {
      console.log("Deriv WS Connected", this.token ? "with token" : "without token");
      if (this.readyResolver) {
        this.readyResolver();
        this.readyResolver = null;
      }
      if (this.token) {
        this.send({ authorize: this.token }).then(() => {
          this.send({ balance: 1, subscribe: 1 }).catch(() => {});
          this.send({ proposal_open_contract: 1, subscribe: 1 }).catch(() => {});
          this.startPing();
        }).catch(e => {
          console.error("Deriv Auth Error:", e);
          if (this.onBalance) this.onBalance(0);
        });
      } else {
        this.startPing();
      }
    };
    
    this.ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      if (data.req_id && this.reqMap[data.req_id]) {
        if (data.error) this.reqMap[data.req_id].reject(data.error);
        else this.reqMap[data.req_id].resolve(data);
        delete this.reqMap[data.req_id];
      }
      
      if (data.msg_type === 'tick') {
        if (this.onTick) this.onTick(data.tick);
      }
      if (data.msg_type === 'proposal_open_contract') {
        if (this.onOpenContract && data.proposal_open_contract) {
          this.onOpenContract(data.proposal_open_contract);
        }
      }
      if (data.msg_type === 'balance') {
        if (this.onBalance && data.balance && data.balance.balance !== undefined) {
          this.onBalance(data.balance.balance);
        }
      }
    };
    
    this.ws.onclose = () => {
      console.log("Deriv WS Disconnected. Reconnecting...");
      setTimeout(() => this.connect(this.token || undefined), 5000);
    };
  }
  
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  startPing() {
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === 1) {
        const start = Date.now();
        this.send({ ping: 1 }).then(() => {
          if (this.onLatency) this.onLatency(Date.now() - start);
        }).catch(() => {});
      }
    }, 5000);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async send(payload: Record<string, unknown>): Promise<any> {
    if (!this.ws || this.ws.readyState !== 1) {
      if (this.readyPromise) {
        await this.readyPromise;
      }
      if (!this.ws || this.ws.readyState !== 1) {
        throw new Error("WS not connected");
      }
    }
    
    return new Promise((resolve, reject) => {
      const id = this.reqId++;
      this.reqMap[id] = { resolve, reject };
      this.ws!.send(JSON.stringify({ ...payload, req_id: id }));
    });
  }

  async subscribeTicks(symbol: string) {
    await this.send({ ticks: symbol, subscribe: 1 });
  }

  async getCandles(symbol: string, count: number, granularity: number) {
    const res = await this.send({
      ticks_history: symbol,
      adjust_start_time: 1,
      count,
      end: "latest",
      style: "candles",
      granularity
    });
    return res.candles;
  }

  async copyStart() {
    // maybe sub to open contracts
  }

  async buyContract(symbol: string, amount: number, contractType: "CALL" | "PUT", duration: number, durationUnit = "s") {
    // 1. Get proposal
    const proposalRes = await this.send({
      proposal: 1,
      amount,
      basis: "stake",
      contract_type: contractType,
      currency: "USD",
      duration,
      duration_unit: durationUnit,
      symbol: symbol
    });
    
    if (proposalRes.proposal && proposalRes.proposal.id) {
      // 2. Buy
      const buyRes = await this.send({
        buy: proposalRes.proposal.id,
        price: amount
      });
      return buyRes.buy;
    }
  }

  async sellContract(contractId: number, price: number = 0) {
    const res = await this.send({
      sell: contractId,
      price: price
    });
    return res.sell;
  }

  disconnect() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }
  async getProfitTable(limit = 10) {
    const res = await this.send({
      profit_table: 1,
      description: 1,
      limit
    });
    return res.profit_table;
  }
}

export const derivAPI = new DerivAPI();
