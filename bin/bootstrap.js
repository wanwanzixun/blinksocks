const fs = require('fs');
const path = require('path');
const program = require('commander');
const packageJson = require('../package.json');

// const BOOTSTRAP_TYPE_CLIENT = 0;
const BOOTSTRAP_TYPE_SERVER = 1;

const version = packageJson.version;
const usage = '--config <file> --host <host> --port <port> --key <key> [...]';

const options = [
  ['-c, --config <file>', 'a json/js format file for configuration', ''],
  ['--host <host>', 'an ip address or a hostname to bind, default: \'localhost\'', 'localhost'],
  ['--port <port>', 'where to listen on, default: 1080', 1080],
  ['--key <key>', 'a key for encryption and decryption'],
  ['--redirect [redirect]', 'redirect stream to here when any preset fail to process, default: \'\'', ''],
  ['--log-level [log-level]', 'log level, default: \'silly\'', 'silly'],
  ['--timeout [timeout]', 'time to close connection if inactive, default: 600', 600],
  ['-q, --quiet [quiet]', 'force log level to \'error\', default: false', false],
  ['-w, --watch [watch]', 'hot reload config.json specified via -c, default: true', true],
  ['--profile [profile]', 'generate performance statistics, store at blinksocks.profile.log once exit, default: false', false]
];

const examples = `
  Examples:
  
  As simple as possible:
    $ blinksocks client -c config.js
    $ blinksocks server -c config.js
`;

/**
 * get raw config object from json or command line options
 * @param type, BOOTSTRAP_TYPE_CLIENT or BOOTSTRAP_TYPE_SERVER
 * @param options
 * @returns {object}
 */
function obtainConfig(type, options) {
  // CLI options should be able to overwrite options specified in --config
  const {host, servers, key, presets, redirect, quiet} = options;

  // pre-process
  const [port, log_level, timeout, watch, profile] = [
    parseInt(options.port, 10),
    quiet ? 'error' : options.logLevel,
    parseInt(options.timeout, 10),
    !!options.watch,
    !!options.profile
  ];

  // assemble, undefined fields will be omitted
  const config = {
    host,
    port,
    servers,
    key,
    presets,
    redirect,
    log_level,
    timeout,
    watch,
    profile
  };

  // --config, if provided, options in config.json should be able to overwrite CLI options
  if (options.config !== '') {
    // resolve to absolute path
    const file = path.resolve(process.cwd(), options.config);
    try {
      let json;
      const ext = path.extname(file);
      if (ext === '.js') {
        // require .js directly
        json = require(file);
      } else {
        // others are treated as .json
        const jsonFile = fs.readFileSync(file);
        json = JSON.parse(jsonFile);
      }
      Object.assign(config, json);
    } catch (err) {
      throw Error(`fail to parse your \'${options.config}\'`);
    }
  }

  /// post-process
  if (type === BOOTSTRAP_TYPE_SERVER) {
    delete config.servers;
  } else {
    config.servers = config.servers.filter((server) => server[0] !== '-');
  }
  return config;
}

module.exports = function (type, {Hub, Config}) {
  const pg = program.version(version).usage(usage);

  for (const option of options) {
    pg.option(...option);
  }

  program.on('--help', () => console.log(examples));
  program.parse(process.argv);

  // no options provided
  if (process.argv.length < 3) {
    program.help();
    process.exit(0);
  }

  if (program.config !== '' && program.watch) {
    fs.watchFile(program.config, function (curr, prev) {
      if (curr.mtime > prev.mtime) {
        console.log(`==> [bootstrap] ${program.config} has changed, reload`);
        try {
          Config.init(obtainConfig(type, program));
          console.info(JSON.stringify(Config.abstract(), null, '  '));
        } catch (err) {
          console.error(err.message);
        }
      }
    });
  }

  try {
    Config.init(obtainConfig(type, program));
    const app = new Hub();
    app.run();
    process.on('SIGINT', () => app.onClose());
  } catch (err) {
    console.error(err);
    process.exit(-1);
  }
};
