const { src, dest } = require('gulp');

function copyNodeIcons() {
	return src('nodes/**/*.{png,svg}').pipe(dest('dist/nodes'));
}

function copyCredentialIcons() {
	return src('credentials/**/*.{png,svg}', { allowEmpty: true }).pipe(dest('dist/credentials'));
}

exports['build:icons'] = async function buildIcons() {
	await new Promise((resolve, reject) => copyNodeIcons().on('end', resolve).on('error', reject));
	await new Promise((resolve, reject) =>
		copyCredentialIcons().on('end', resolve).on('error', reject),
	);
};
