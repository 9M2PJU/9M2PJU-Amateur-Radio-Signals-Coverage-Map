FROM debian:bookworm-slim AS itm-builder

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /build
RUN git clone --depth 1 https://github.com/NTIA/itm.git
COPY native/itm_runner.cpp /build/itm_runner.cpp
RUN sed -i 's|..\\include\\|../include/|g' itm/src/*.cpp \
  && sed -i 's/#define DLLEXPORT.*/#define DLLEXPORT extern "C"/' itm/include/itm.h \
  && g++ -std=c++17 -O2 -D'__declspec(x)=' -Iitm/include /build/itm_runner.cpp itm/src/*.cpp -o /build/itm-runner

FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=8787 \
    ITM_RUNNER=/usr/local/bin/itm-runner

WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY --from=itm-builder /build/itm-runner /usr/local/bin/itm-runner

EXPOSE 8787
CMD ["node", "server.js"]
