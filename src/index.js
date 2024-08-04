const core = require('@actions/core');

const IS_POST = !!core.getState('isPost');

const main = async () => {
    try {
        if (!IS_POST) {
            core.info('Hello World!');
        } else {
            core.info('Hello World! (post)');
        }
    } catch (error) {
        core.setFailed(error);
    }
}

main();
