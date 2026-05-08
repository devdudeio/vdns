FROM golang:1.23-bookworm AS build

ARG COREDNS_VERSION=v1.12.1
WORKDIR /src/vns
COPY . .
RUN cd coredns && COREDNS_VERSION="${COREDNS_VERSION}" ./build-coredns.sh

FROM debian:bookworm-slim
COPY --from=build /src/vns/coredns/coredns-vns /usr/local/bin/coredns
COPY coredns/Corefile.example /etc/coredns/Corefile
EXPOSE 1053/udp 1053/tcp
ENTRYPOINT ["/usr/local/bin/coredns"]
CMD ["-conf", "/etc/coredns/Corefile"]
