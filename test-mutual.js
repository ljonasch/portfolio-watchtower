const tickers = ["VFIAX", "FXAIX", "VTSAX"];
const url = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${tickers.join(",")}&range=1d&interval=1d`;
fetch(url).then(r=>r.json()).then(j=>console.log(JSON.stringify(j, null, 2)));
