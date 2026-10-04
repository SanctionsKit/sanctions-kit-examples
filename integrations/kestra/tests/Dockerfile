FROM eclipse-temurin:25-jre-noble@sha256:398f810215757dc1926390014272579fb0e57c41ef1c8aa4f64ae761613a168b AS java
FROM python:3.13-slim-trixie@sha256:bb2988715db2cf7ace7b53f38f3cffbef7c7046a656bee66245eb0ed386e2e81
COPY --from=java /opt/java/openjdk /opt/java/openjdk
ENV JAVA_HOME=/opt/java/openjdk
ENV PATH=/opt/java/openjdk/bin:$PATH
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
COPY . /opt/example
RUN python /opt/example/tests/bootstrap.py
RUN java -jar /opt/kestra/kestra-2.0.4 plugins install --locally \
    -p /opt/kestra/plugins -c /opt/example/tests/local-kestra.yml \
    io.kestra.plugin:plugin-serdes:2.0.6
RUN python -c "import hashlib,pathlib; p=pathlib.Path('/opt/kestra/plugins/io_kestra_plugin__plugin-serdes__2_0_6.jar'); assert hashlib.sha256(p.read_bytes()).hexdigest() == '1394bf5ec0e7a57e446adc2b326e4ac72651d3fe525853d4d1c92bef60fe117e'"
WORKDIR /work
ENTRYPOINT ["python", "/opt/example/tests/container_runner.py"]
